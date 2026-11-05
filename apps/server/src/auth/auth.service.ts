import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthResSchema, type GuestReq, type LoginReq } from '@tdvh/shared';
import type { z } from 'zod';
import { CLOCK, startOfVnDay, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { GAME_CONFIG, type GameConfig } from '../core/game-config.js';
import { PrismaService } from '../core/prisma.service.js';
import { withTx } from '../core/tx.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';
import { JWT_SECRET, signAccessToken } from '../core/jwt.js';
import { RefreshTokenService, type IssuedRefresh } from './refresh-token.service.js';

export const AUTH_GUEST_CREATED = 'AUTH_GUEST_CREATED';

// Argon2id hash of a fixed string with the §3.10.7 parameters. Verified against when there is no
// matching user, so a wrong username costs the same time as a wrong password.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$bdEr3G4qrGrEdC8IynmJag$6xQDjWDIUp+r6GNtYzoNgH+RXItNHKXEOCBoaMMFCwI';

const DAY_MS = 24 * 60 * 60 * 1000;

type AuthRes = z.output<typeof AuthResSchema>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GAME_CONFIG) private readonly config: GameConfig,
    @Inject(JWT_SECRET) private readonly secret: string,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // ipHash = sha256(ip + ':' + JWT_SECRET). The raw IP is never stored (§3.6.4).
  ipHash(ip: string): string {
    return createHash('sha256').update(`${ip}:${this.secret}`).digest('hex');
  }

  async createGuest(ip: string, input: GuestReq): Promise<{ auth: AuthRes; refresh: IssuedRefresh }> {
    const ipHash = this.ipHash(ip);
    const now = this.clock.now();
    const user = await withTx(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`guest-ip:${ipHash}`}, 0))`;
      const used = await tx.auditLog.count({
        where: {
          action: AUTH_GUEST_CREATED,
          createdAt: { gte: startOfVnDay(now) },
          metadata: { path: ['ipHash'], equals: ipHash },
        },
      });
      if (used >= this.config.guestsPerIpPerDay) {
        const nextVnDay = startOfVnDay(now).getTime() + DAY_MS;
        throw new AppError('RATE_LIMITED', 'guest limit reached for today', {
          retryAfterMs: nextVnDay - now.getTime(),
        });
      }
      const created = await this.users.createGuest(tx, input);
      const refresh = await this.refreshTokens.issueInTx(tx, created.id, now);
      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: AUTH_GUEST_CREATED,
          targetType: 'User',
          targetId: created.id,
          metadata: { ipHash },
          createdAt: now,
        },
      });
      return { created, refresh };
    });
    return { auth: await this.authResponse(user.created), refresh: user.refresh };
  }

  async login(input: LoginReq): Promise<{ auth: AuthRes; refresh: IssuedRefresh }> {
    const user = await this.prisma.user.findUnique({ where: { username: input.username } });
    // Always exactly one verify, so a missing user and a wrong password take the same time.
    const ok = await this.passwords.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
    if (!user || !user.passwordHash || !ok) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const refresh = await this.refreshTokens.issue(user.id);
    return { auth: await this.authResponse(user), refresh };
  }

  // Rotates the presented refresh token and returns a new access token and refresh token.
  async refresh(raw: string): Promise<{ auth: { accessToken: string }; refresh: IssuedRefresh }> {
    const next = await this.refreshTokens.rotate(raw);
    return { auth: { accessToken: await signAccessToken(this.secret, next.userId) }, refresh: next };
  }

  logout(raw: string | undefined): Promise<void> {
    return raw ? this.refreshTokens.revoke(raw) : Promise.resolve();
  }

  private async authResponse(user: {
    id: string;
    kind: string;
    username: string | null;
    role: string;
    mutedUntil: Date | null;
    createdAt: Date;
  }): Promise<AuthRes> {
    return {
      accessToken: await signAccessToken(this.secret, user.id),
      user: {
        id: user.id,
        kind: user.kind as AuthRes['user']['kind'],
        username: user.username,
        role: user.role as AuthRes['user']['role'],
        mutedUntil: user.mutedUntil?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
    };
  }
}
