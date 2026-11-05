import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

export type Tx = Prisma.TransactionClient;
export interface TxOptions {
  // Number of retries after the first attempt (default 3). Total attempts = 1 + maxRetries.
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;
// deadlock_detected, serialization_failure, lock_not_available
const RETRYABLE_PG_CODES = new Set(['40P01', '40001', '55P03']);

// SQLSTATE of a driver error. Prisma 7 with the pg adapter puts it under meta.driverAdapterError.
// Do not rely on P2034: a deadlock surfaces as P2010 with cause.originalCode 40P01.
export function pgCode(err: unknown): string | undefined {
  const e = err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } } | null | undefined;
  const code = e?.meta?.driverAdapterError?.cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}

// The only place in the application that calls prisma.$transaction (checked by check:money).
export async function withTx<T>(
  prisma: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  opts?: TxOptions,
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
          return fn(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 3000,
          timeout: 8000,
        },
      );
    } catch (err) {
      const code = pgCode(err);
      if (code === undefined || !RETRYABLE_PG_CODES.has(code)) throw err;
      if (attempt >= maxRetries) {
        throw new AppError('INTERNAL_ERROR', `transaction retry limit reached (pgCode ${code})`);
      }
      await sleep(50 + Math.random() * 150);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
