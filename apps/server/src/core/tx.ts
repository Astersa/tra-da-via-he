// STUB (step 1 of M0-E2-T3): single attempt, no retry, no pgCode. Replaced in step 2.
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;
export interface TxOptions {
  maxRetries?: number;
}

export function withTx<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>, _opts?: TxOptions): Promise<T> {
  return prisma.$transaction(fn);
}

export function pgCode(_err: unknown): string | undefined {
  return undefined;
}
