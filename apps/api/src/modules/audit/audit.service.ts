import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { auditLogs, DatabaseInstance } from '@restaurant-cloud/database';
import { UUID, TenantContext } from '@restaurant-cloud/domain-kernel';
import { AuditLogQuery } from '@restaurant-cloud/shared-contracts';
import { eq, and, desc, sql } from 'drizzle-orm';

export interface RecordAuditParams {
  tenantId: UUID;
  actorId?: UUID;
  action: string;
  entityType: string;
  entityId: UUID;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  correlationId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Records an immutable audit log entry.
   * If a transaction `tx` is provided, the entry is written inside that transaction
   * under the active RLS tenant context for strict atomicity.
   */
  async log(params: RecordAuditParams, tx?: DatabaseInstance): Promise<void> {
    const client = tx || this.dbService.db;
    await client.insert(auditLogs).values({
      tenantId: params.tenantId,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeState: params.beforeState ? JSON.stringify(params.beforeState) : null,
      afterState: params.afterState ? JSON.stringify(params.afterState) : null,
      correlationId: params.correlationId,
    });
  }

  /**
   * Queries immutable audit trail with filtering and pagination
   */
  async queryLogs(context: TenantContext, query: AuditLogQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const page = query.page || 1;
      const limit = query.limit || 20;
      const offset = (page - 1) * limit;

      const conditions = [eq(auditLogs.tenantId, context.tenantId)];
      if (query.entityType) {
        conditions.push(eq(auditLogs.entityType, query.entityType));
      }
      if (query.action) {
        conditions.push(eq(auditLogs.action, query.action));
      }
      if (query.actorId) {
        conditions.push(eq(auditLogs.actorId, query.actorId));
      }

      const rows = await tx
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.occurredAt))
        .limit(limit)
        .offset(offset);

      const [countResult] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(and(...conditions));

      return {
        items: rows,
        total: countResult?.total || 0,
        page,
        limit,
      };
    });
  }
}
