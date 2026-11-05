import { Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, type Algorithm } from '@node-rs/argon2';

// Argon2id = 2 in @node-rs/argon2 (const enum, unusable under isolatedModules).
const ARGON2ID = 2 as Algorithm;

// Parameters from IMPLEMENTATION-PLAN.md §3.10.7. Do not change without a security decision.
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// At most this many hashing operations run at once in this process.
const MAX_CONCURRENT = 2;

@Injectable()
export class PasswordService {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  hash(plain: string): Promise<string> {
    return this.slot(() => argonHash(plain, ARGON2_OPTIONS));
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return this.slot(() => argonVerify(hash, plain));
  }

  // Hands the slot directly to the next waiter, so a new caller cannot jump the queue.
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < MAX_CONCURRENT) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
