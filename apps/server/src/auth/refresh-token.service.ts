import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { PrismaService } from '../core/prisma.service.js';
import { withTx, type Tx } from '../core/tx.js';

// Cookie name and attributes (IMPLEMENTATION-PLAN.md §3.3). Secure is added in production only.
export const REFRESH_COOKIE = 'tdvh_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A token revoked by rotation can be presented again within this window (M1-E1-T2).
export const REFRESH_REUSE_GRACE_SECONDS = 30;

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface IssuedRefresh {
  id: string;
  raw: string;
  userId: string;
}

export function refreshCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    secure: process.env.NODE_ENV === 'production',
    maxAge: REFRESH_TTL_MS,
  };
}

const unauthenticated = (): AppError => new AppError('UNAUTHENTICATED');

type RotateOutcome = { kind: 'ok'; id: string; raw: string; userId: string } | { kind: 'invalid' } | { kind: 'reuse' };

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Creates a token inside the caller's transaction. Only the sha256 is stored.
  async issueInTx(tx: Tx, userId: string, now: Date): Promise<IssuedRefresh> {
    const raw = randomBytes(32).toString('base64url');
    const row = await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(raw),
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        createdAt: now,
      },
      select: { id: true },
    });
    return { id: row.id, raw, userId };
  }

  async issue(userId: string): Promise<IssuedRefresh> {
    const now = this.clock.now();
    return withTx(this.prisma, (tx) => this.issueInTx(tx, userId, now));
  }

  // Rotation runs in one withTx. It locks the user, re-reads the token row, and then either
  // rotates, applies the reuse grace window, or revokes every token of the user.
  // The mass revocation returns normally so it commits; the error is thrown after the commit.
  async rotate(raw: string): Promise<IssuedRefresh> {
    const hash = hashRefreshToken(raw);
    // Read before locking only to learn the userId that the lock key needs.
    const seen = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      select: { userId: true },
    });
    if (!seen) throw unauthenticated();

    const outcome: RotateOutcome = await withTx(this.prisma, async (tx): Promise<RotateOutcome> => {
      const now = this.clock.now();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refresh:${seen.userId}`}, 0))`;

      const row = await tx.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!row) return { kind: 'invalid' };
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { bannedAt: true } });
      if (!user || user.bannedAt) return { kind: 'invalid' };

      if (row.revokedAt === null) {
        if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'invalid' };
        const next = await this.issueInTx(tx, row.userId, now);
        await tx.refreshToken.update({
          where: { id: row.id },
          data: { revokedAt: now, replacedBy: next.id },
        });
        return { kind: 'ok', id: next.id, raw: next.raw, userId: row.userId };
      }

      // Revoked token. Grace applies only if it was rotated (replacedBy set) recently and its
      // successor is still live.
      const elapsedMs = now.getTime() - row.revokedAt.getTime();
      if (row.replacedBy !== null && elapsedMs <= REFRESH_REUSE_GRACE_SECONDS * 1000) {
        const successor = await tx.refreshToken.findUnique({ where: { id: row.replacedBy } });
        if (successor && successor.revokedAt === null && successor.expiresAt.getTime() > now.getTime()) {
          await tx.refreshToken.update({ where: { id: successor.id }, data: { revokedAt: now } });
          const next = await this.issueInTx(tx, row.userId, now);
          await tx.refreshToken.update({
            where: { id: row.id },
            data: { replacedBy: next.id },
          });
          return { kind: 'ok', id: next.id, raw: next.raw, userId: row.userId };
        }
      }

      // Reuse outside the grace window: treat as theft and revoke every live token of the user.
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { kind: 'reuse' };
    });

    if (outcome.kind !== 'ok') throw unauthenticated();
    return { id: outcome.id, raw: outcome.raw, userId: outcome.userId };
  }

  // Logout revokes the presented token. An unknown or already revoked token is a no-op.
  // Returns the owner's userId when the token exists, so the caller can disconnect that user.
  async revoke(raw: string): Promise<string | undefined> {
    const hash = hashRefreshToken(raw);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash }, select: { userId: true } });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
    return row?.userId;
  }

}
