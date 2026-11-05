import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ErrorCode } from '@tdvh/shared';
import type { Response } from 'express';
import { AppError } from './errors.js';

// HTTP status per error code. Unlisted business codes fall back to 400.
const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DISPLAY_NAME_TAKEN: 409,
  USERNAME_TAKEN: 409,
  ALREADY_REGISTERED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

// Single response shape {error:{code,message,details?}} (IMPLEMENTATION-PLAN.md §3.3).
// Anything that is not an AppError or a client HTTP error becomes INTERNAL_ERROR without its message.
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      const details: Record<string, unknown> = { ...(exception.details ?? {}) };
      if (exception.retryable) details.retryable = true;
      const body: ErrorBody = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(Object.keys(details).length > 0 ? { details } : {}),
        },
      };
      res.status(STATUS[exception.code] ?? 400).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode = status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
      res.status(status).json({ error: { code, message: status === 404 ? 'not found' : 'bad request' } });
      return;
    }

    // Malformed JSON body: body-parser sets expose=true and a 4xx status.
    const http = exception as { status?: unknown; expose?: unknown } | null;
    if (http && http.expose === true && typeof http.status === 'number' && http.status >= 400 && http.status < 500) {
      res.status(http.status).json({ error: { code: 'VALIDATION_FAILED', message: 'bad request' } });
      return;
    }

    this.logger.error(`unhandled error: ${(exception as Error | null)?.name ?? typeof exception}`);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'internal error', details: { retryable: true } },
    } satisfies ErrorBody);
  }
}
