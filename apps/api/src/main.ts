import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'production',
  });

  await fastifyAdapter.register(fastifyMultipart as any, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
      files: 5,
    },
  });

  // Native Fastify Security Headers Hook (Defense-in-Depth without extra dependencies)
  fastifyAdapter.getInstance().addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';");
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter
  );

  // 1. Enable Global Exception Filter for sanitization and structured responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 2. Enable Graceful Shutdown Hooks to cleanly drain DB pools on SIGTERM/SIGINT
  app.enableShutdownHooks();

  // 3. Strict CORS Configuration
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS request rejected by origin policy'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Restaurant Cloud API running on http://localhost:${port}`);
}

bootstrap();
