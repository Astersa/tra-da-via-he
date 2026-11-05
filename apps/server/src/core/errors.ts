import { RETRYABLE_CODES, type ErrorCode } from '@tdvh/shared';

// Business error carrying a shared ErrorCode. `retryable` follows RETRYABLE_CODES.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.retryable = (RETRYABLE_CODES as readonly string[]).includes(code);
  }
}
