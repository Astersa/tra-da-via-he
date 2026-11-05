import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { waitForIdleTx } from './tx.js';

export const DEFAULT_DB_POOL_MAX = 5;

// Pool size from DB_POOL_MAX (positive integer), default 5 (IMPLEMENTATION-PLAN.md §3.10.7).
export function readPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DB_POOL_MAX;
  if (raw === undefined || raw === '') return DEFAULT_DB_POOL_MAX;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`DB_POOL_MAX must be a positive integer, got "${raw}"`);
  return Number(raw);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('PrismaService');

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    super({ adapter: new PrismaPg({ connectionString, max: readPoolMax() }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // Runs after the HTTP server has closed. Waits for withTx calls in flight (§3.10.4), then disconnects.
  // A timeout is logged and the disconnect still happens: shutdown never throws from here.
  async onApplicationShutdown(): Promise<void> {
    if (!(await waitForIdleTx())) {
      this.logger.warn('shutdown: transactions still running after the wait; disconnecting anyway');
    }
    await this.$disconnect();
  }
}
