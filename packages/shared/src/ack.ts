import type { ErrorCode } from "./errors.js";

// Ack thống nhất cho mọi event client → server (§3.4).
export type Ack<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        retryAfterMs?: number;
      };
    };

// Mã có thể thử lại (§3.4.2 "Lỗi chung").
export const RETRYABLE_CODES = ["RATE_LIMITED", "INTERNAL_ERROR"] as const satisfies readonly ErrorCode[];

export function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}
