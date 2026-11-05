import { Injectable } from '@nestjs/common';
import { displayNameKey, type AvatarIdSchema } from '@tdvh/shared';
import type { z } from 'zod';
import { AppError } from '../core/errors.js';
import { pgCode, type Tx } from '../core/tx.js';

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

@Injectable()
export class UsersService {
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
}
