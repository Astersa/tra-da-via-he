import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from './errors.js';
import type { Tx } from './tx.js';

// Reads User.kind from the DB on every call. Never trust kind from the JWT or the request.
// A GUEST gets ACCOUNT_REQUIRED (§3.3, §3.7).
export async function assertRegistered(db: PrismaClient | Tx, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { kind: true } });
  if (!user) throw new AppError('NOT_FOUND');
  if (user.kind === 'GUEST') throw new AppError('ACCOUNT_REQUIRED');
}
