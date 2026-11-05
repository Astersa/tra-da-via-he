import { Injectable } from '@nestjs/common';
import { displayNameKey, type AvatarIdSchema, type PatchProfileReq } from '@tdvh/shared';
import type { z } from 'zod';
import { AppError } from '../core/errors.js';
import { pgCode, type Tx } from '../core/tx.js';
import { PrismaService } from '../core/prisma.service.js';

export interface NewGuest {
  displayName: string;
  avatarId: z.output<typeof AvatarIdSchema>;
}

// Unique violation (SQLSTATE 23505) on the named constraint. Checked on the driver error text.
function isUniqueViolation(err: unknown, constraintFragment: string): boolean {
  if (pgCode(err) !== '23505') return false;
  const cause = (err as { meta?: { driverAdapterError?: unknown } } | null)?.meta?.driverAdapterError;
  return JSON.stringify(cause ?? {}).includes(constraintFragment) || String((err as Error).message).includes(constraintFragment);
}

const iso = (d: Date): string => d.toISOString();

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Runs inside the caller's transaction. Creates User (GUEST), PlayerProfile and an empty Wallet.
  async createGuest(tx: Tx, input: NewGuest) {
    try {
      return await tx.user.create({
        data: {
          kind: 'GUEST',
          wallet: { create: {} },
          profile: {
            create: {
              displayName: input.displayName,
              displayNameKey: displayNameKey(input.displayName),
              avatarId: input.avatarId,
            },
          },
        },
        include: { profile: true, wallet: true },
      });
    } catch (err) {
      if (isUniqueViolation(err, 'displayNameKey')) throw new AppError('DISPLAY_NAME_TAKEN');
      throw err;
    }
  }

  // Own user only. passwordHash is never selected or returned.
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user || !user.profile) throw new AppError('NOT_FOUND');
    return {
      user: {
        id: user.id,
        kind: user.kind,
        username: user.username,
        role: user.role,
        mutedUntil: user.mutedUntil ? iso(user.mutedUntil) : null,
        createdAt: iso(user.createdAt),
      },
      profile: { userId: user.id, displayName: user.profile.displayName, avatarId: user.profile.avatarId },
    };
  }

  // Renaming a character: displayNameKey follows displayName. A clash with another profile is
  // DISPLAY_NAME_TAKEN; keeping one's own current name does not clash (the unique index skips own row).
  async updateProfile(userId: string, input: PatchProfileReq) {
    const data: { displayName?: string; displayNameKey?: string; avatarId?: string } = {};
    if (input.displayName !== undefined) {
      data.displayName = input.displayName;
      data.displayNameKey = displayNameKey(input.displayName);
    }
    if (input.avatarId !== undefined) data.avatarId = input.avatarId;
    try {
      const profile = await this.prisma.playerProfile.update({ where: { userId }, data });
      return { userId: profile.userId, displayName: profile.displayName, avatarId: profile.avatarId };
    } catch (err) {
      if (isUniqueViolation(err, 'displayNameKey')) throw new AppError('DISPLAY_NAME_TAKEN');
      throw err;
    }
  }
}
