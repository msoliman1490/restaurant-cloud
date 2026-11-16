import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap, switchMap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '@restaurant-cloud/database';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { DatabaseService } from '../../database/database.service';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorators/require-idempotency.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();
    if (!request) return next.handle();

    const method = String(request.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return next.handle();
    }

    const tenantContext: TenantContext | undefined = request.tenantContext;
    if (!tenantContext?.tenantId) {
      return next.handle();
    }

    const headerKey =
      request.headers?.['idempotency-key'] ?? request.headers?.['x-idempotency-key'];
    const bodyKey =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>).idempotencyKey
        : undefined;
    const rawKey = typeof headerKey === 'string' ? headerKey : typeof bodyKey === 'string' ? bodyKey : '';
    const idempotencyKey = rawKey.trim();

    if (!idempotencyKey || idempotencyKey.length < 3 || idempotencyKey.length > 255) {
      const isRequired = this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isRequired) {
        const strictHeader = String(request.headers?.['x-idempotency-mode'] || '').toLowerCase();
        if (strictHeader === 'strict' || process.env.STRICT_IDEMPOTENCY === 'true') {
          throw new BadRequestException(
            'Idempotency-Key header is required for this sensitive financial operation.'
          );
        }
        if (typeof reply?.header === 'function') {
          reply.header('X-Idempotency-Warning', 'missing-key');
        }
      }
      return next.handle();
    }

    const rawUrl: string =
      request.routeOptions?.url ||
      request.routerPath ||
      (typeof request.url === 'string' ? request.url.split('?')[0] : '') ||
      'unknown';
    const scope = `${method}:${rawUrl}`.slice(0, 50);
    const requestHash = createHash('sha256')
      .update(`${scope}:${JSON.stringify(request.body ?? {})}`)
      .digest('hex');

    return from(this.acquireOrReplay(tenantContext, scope, idempotencyKey, requestHash)).pipe(
      switchMap((decision) => {
        if (decision.replay) {
          return of(decision.response);
        }

        return next.handle().pipe(
          mergeMap((response) =>
            from(
              this.markCompleted(tenantContext, scope, idempotencyKey, response)
            ).pipe(switchMap(() => of(response)))
          ),
          catchError((err) =>
            from(this.releaseLock(tenantContext, scope, idempotencyKey)).pipe(
              switchMap(() => throwError(() => err))
            )
          )
        );
      })
    );
  }

  private async acquireOrReplay(
    tenantContext: TenantContext,
    scope: string,
    idempotencyKey: string,
    requestHash: string
  ): Promise<{ replay: boolean; response?: unknown }> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const inserted = await this.dbService.withTenantContext(tenantContext, async (tx) => {
      return tx
        .insert(idempotencyKeys)
        .values({
          tenantId: tenantContext.tenantId,
          scope,
          idempotencyKey,
          requestHash,
          status: 'PROCESSING',
          expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
    });

    if (inserted.length > 0) {
      return { replay: false };
    }

    // Another concurrent or earlier request owns this (tenantId, scope, idempotencyKey).
    for (let attempt = 0; attempt < 25; attempt++) {
      const [existing] = await this.dbService.withTenantContext(tenantContext, async (tx) => {
        return tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.tenantId, tenantContext.tenantId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.idempotencyKey, idempotencyKey)
            )
          )
          .limit(1);
      });

      if (!existing) {
        // Released by a failed concurrent request; retry acquiring
        const retryIns = await this.dbService.withTenantContext(tenantContext, async (tx) => {
          return tx
            .insert(idempotencyKeys)
            .values({
              tenantId: tenantContext.tenantId,
              scope,
              idempotencyKey,
              requestHash,
              status: 'PROCESSING',
              expiresAt,
            })
            .onConflictDoNothing()
            .returning({ id: idempotencyKeys.id });
        });
        if (retryIns.length > 0) return { replay: false };
      } else if (existing.status === 'COMPLETED') {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException(
            `Idempotency-Key '${idempotencyKey}' was already used with a different request payload.`
          );
        }
        return {
          replay: true,
          response: existing.responseSnapshot ? JSON.parse(existing.responseSnapshot) : null,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    throw new ConflictException(
      'A duplicate request with this Idempotency-Key is currently processing. Please retry shortly.'
    );
  }

  private async markCompleted(
    tenantContext: TenantContext,
    scope: string,
    idempotencyKey: string,
    response: unknown
  ): Promise<void> {
    try {
      await this.dbService.withTenantContext(tenantContext, async (tx) => {
        await tx
          .update(idempotencyKeys)
          .set({
            status: 'COMPLETED',
            responseSnapshot: JSON.stringify(response ?? null),
          })
          .where(
            and(
              eq(idempotencyKeys.tenantId, tenantContext.tenantId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.idempotencyKey, idempotencyKey)
            )
          );
      });
    } catch {
      // Never fail the already-committed business response if snapshot persistence hits an edge error
    }
  }

  private async releaseLock(
    tenantContext: TenantContext,
    scope: string,
    idempotencyKey: string
  ): Promise<void> {
    try {
      await this.dbService.withTenantContext(tenantContext, async (tx) => {
        await tx
          .delete(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.tenantId, tenantContext.tenantId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.idempotencyKey, idempotencyKey),
              eq(idempotencyKeys.status, 'PROCESSING')
            )
          );
      });
    } catch {
      // Best-effort cleanup
    }
  }
}
