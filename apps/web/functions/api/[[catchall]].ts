/**
 * Cloudflare Pages Function: Reverse Proxy for /api/*
 * Routes incoming API requests to the containerized NestJS Backend
 * Preserves Single-Domain Same-Origin Policy (Zero CORS issues)
 */

interface Env {
  BACKEND_ORIGIN_URL?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env } = context;

  // 1. Resolve Backend Origin URL from environment
  // In production, BACKEND_ORIGIN_URL is configured in Cloudflare Pages dashboard.
  const backendOrigin = env.BACKEND_ORIGIN_URL;

  if (!backendOrigin) {
    return new Response(
      JSON.stringify({
        statusCode: 502,
        error: 'Bad Gateway',
        message: 'Backend origin service is not configured (BACKEND_ORIGIN_URL missing in environment).',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  // 2. Construct destination target URL
  const originalUrl = new URL(request.url);
  const targetUrl = new URL(originalUrl.pathname + originalUrl.search, backendOrigin);

  // 3. Prepare proxy headers (preserves Authorization, Cookies, Content-Type)
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('X-Forwarded-Host', originalUrl.host);
  forwardedHeaders.set('X-Forwarded-Proto', originalUrl.protocol.replace(':', ''));
  // Strip Cloudflare-internal headers before forwarding
  forwardedHeaders.delete('cf-connecting-ip');
  forwardedHeaders.delete('cf-ray');
  forwardedHeaders.delete('cf-visitor');

  // 4. Handle request body (avoid passing body for GET/HEAD)
  const isBodyAllowed = request.method !== 'GET' && request.method !== 'HEAD';
  const requestBody = isBodyAllowed ? request.body : null;

  try {
    // 5. Proxy the request with an upstream timeout of 25 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: forwardedHeaders,
      body: requestBody,
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 6. Return upstream response preserving status and response headers
    const responseHeaders = new Headers(upstreamResponse.headers);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const isTimeout = (err as Error)?.name === 'AbortError';
    const statusCode = isTimeout ? 504 : 502;
    const errorMessage = isTimeout
      ? 'Gateway Timeout: Upstream backend service did not respond in time.'
      : 'Bad Gateway: Unable to connect to upstream backend service.';

    return new Response(
      JSON.stringify({
        statusCode,
        error: isTimeout ? 'Gateway Timeout' : 'Bad Gateway',
        message: errorMessage,
      }),
      {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
