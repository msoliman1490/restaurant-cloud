import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';

interface FastifyReplyLike {
  status(code: number): {
    send(body: unknown): void;
  };
}

interface FastifyRequestLike {
  url: string;
  method: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReplyLike>();
    const request = ctx.getRequest<FastifyRequestLike>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message: string | string[] = 'An unexpected internal error occurred';
    let details: unknown = undefined;

    const isZod =
      exception instanceof ZodError ||
      (typeof exception === 'object' &&
        exception !== null &&
        (exception as { name?: string }).name === 'ZodError');

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | string[]) || exception.message;
        errorCode = (resObj.error as string) || exception.name;
      }
    } else if (isZod) {
      const zodErr = exception as ZodError;
      status = HttpStatus.BAD_REQUEST;
      errorCode = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = (zodErr.errors || []).map((e) => ({
        path: (e.path || []).join('.'),
        message: e.message,
      }));
    } else if (exception instanceof Error) {
      // Internal error: Log full details securely on server, do not expose SQL or internals
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack
      );

      // Sanitize PostgreSQL or ORM error messages to prevent information leakage
      if (
        exception.message.includes('row-level security') ||
        exception.message.includes('violates')
      ) {
        status = HttpStatus.FORBIDDEN;
        errorCode = 'SECURITY_POLICY_VIOLATION';
        message = 'Access denied by database security policy';
      } else {
        message = 'An internal server error occurred';
      }
    }

    response.status(status).send({
      success: false,
      error: {
        statusCode: status,
        code: errorCode,
        message,
        details,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
