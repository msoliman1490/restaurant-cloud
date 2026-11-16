import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const LOGIN_LIMIT = 15;
const MAX_BUCKETS = 10_000;

/**
 * Zero-dependency sliding-window rate limiter guard.
 * Enforces 120 req/min per IP/route and a stricter 15 req/min on /auth/login.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();

    if (!request) {
      return true;
    }

    const rawUrl: string =
      request.routeOptions?.url ||
      request.routerPath ||
      (typeof request.url === 'string' ? request.url.split('?')[0] : '') ||
      'unknown';

    const ip = this.extractClientIp(request);
    const key = `${ip}:${rawUrl}`;
    const limit = rawUrl.includes('/auth/login') ? LOGIN_LIMIT : DEFAULT_LIMIT;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (this.hits.size >= MAX_BUCKETS) {
      this.pruneStaleBuckets(windowStart);
    }

    const timestamps = this.hits.get(key) ?? [];
    const recent = timestamps.filter((ts) => ts > windowStart);

    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
      if (typeof reply?.header === 'function') {
        reply.header('Retry-After', String(retryAfterSec));
        reply.header('X-RateLimit-Limit', String(limit));
        reply.header('X-RateLimit-Remaining', '0');
      }
      this.hits.set(key, recent);
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);

    if (typeof reply?.header === 'function') {
      reply.header('X-RateLimit-Limit', String(limit));
      reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - recent.length)));
    }

    return true;
  }

  private extractClientIp(request: any): string {
    if (typeof request.ip === 'string' && request.ip.length > 0) {
      return request.ip;
    }
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() || 'unknown';
    }
    return request.socket?.remoteAddress || 'unknown';
  }

  private pruneStaleBuckets(windowStart: number): void {
    for (const [k, timestamps] of this.hits.entries()) {
      const recent = timestamps.filter((ts) => ts > windowStart);
      if (recent.length === 0) {
        this.hits.delete(k);
      } else {
        this.hits.set(k, recent);
      }
    }
  }
}
