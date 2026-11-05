import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export const DEFAULT_DB_POOL_MAX = 5;

// Pool size from DB_POOL_MAX (positive integer), default 5 (IMPLEMENTATION-PLAN.md §3.10.7).
export function readPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DB_POOL_MAX;
  if (raw === undefined || raw === '') return DEFAULT_DB_POOL_MAX;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`DB_POOL_MAX must be a positive integer, got "${raw}"`);
  return Number(raw);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    super({ adapter: new PrismaPg({ connectionString, max: readPoolMax() }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
