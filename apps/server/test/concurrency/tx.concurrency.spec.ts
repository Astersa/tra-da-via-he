import { PrismaPg } from '@prisma/adapter-pg';
import { AppError } from '../../src/core/errors.js';
import { pgCode, withTx } from '../../src/core/tx.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { resetDb, seedUser, testPrisma } from '../helpers/db.js';
import { raceAll } from '../helpers/race.js';

// Real PostgreSQL on port 5433. No mocks: deadlocks, unique and CHECK errors are raised by the server.

async function seedWallet(balance: bigint): Promise<string> {
  const user = await seedUser();
  const wallet = await testPrisma.wallet.create({ data: { userId: user.id, balance } });
  return wallet.id;
}

async function captureError(op: () => Promise<unknown>): Promise<unknown> {
  try {
    await op();
  } catch (e) {
    return e;
  }
  throw new Error('expected the operation to fail');
}

// Shifts one wallet by `delta` inside a transaction, taking its row lock.
function bump(tx: Parameters<Parameters<typeof withTx>[1]>[0], walletId: string, delta: bigint): Promise<number> {
  return tx.$executeRaw`UPDATE "Wallet" SET "balance" = "balance" + ${delta} WHERE "id" = ${walletId}::uuid`;
}

describe('withTx', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('retries a real deadlock and both reverse-order transactions finish with correct balances', async () => {
    const a = await seedWallet(1000n);
    const b = await seedWallet(1000n);

    // Barrier: each transaction locks its first wallet, then waits until the other has done the same.
    // Both then request the other's lock, so PostgreSQL must abort one of them.
    let arrived = 0;
    let openBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      openBarrier = resolve;
    });
    const arrive = async () => {
      arrived++;
      if (arrived === 2) openBarrier();
      await barrier;
    };

    let attemptsAB = 0;
    let attemptsBA = 0;
    const runAB = withTx(testPrisma, async (tx) => {
      attemptsAB++;
      await bump(tx, a, -1n);
      await arrive();
      await bump(tx, b, -1n);
    });
    const runBA = withTx(testPrisma, async (tx) => {
      attemptsBA++;
      await bump(tx, b, -1n);
      await arrive();
      await bump(tx, a, -1n);
    });

    const [resAB, resBA] = await Promise.allSettled([runAB, runBA]);

    expect(resAB.status).toBe('fulfilled');
    expect(resBA.status).toBe('fulfilled');
    // At least one transaction was re-run after the deadlock.
    expect(attemptsAB + attemptsBA).toBeGreaterThanOrEqual(3);
    // Each transaction applied its two deltas exactly once (rolled-back attempts leave no effect).
    expect((await testPrisma.wallet.findUnique({ where: { id: a } }))?.balance).toBe(998n);
    expect((await testPrisma.wallet.findUnique({ where: { id: b } }))?.balance).toBe(998n);
  });

  it('does not retry an AppError business failure', async () => {
    let attempts = 0;
    const err = await captureError(() =>
      withTx(testPrisma, async () => {
        attempts++;
        throw new AppError('INSUFFICIENT_FUNDS');
      }),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('INSUFFICIENT_FUNDS');
    expect((err as AppError).retryable).toBe(false);
    expect(attempts).toBe(1);
  });

  it('after the retry budget is spent, throws INTERNAL_ERROR with retryable true', async () => {
    let attempts = 0;
    const err = await captureError(() =>
      withTx(
        testPrisma,
        async (tx) => {
          attempts++;
          // Real server-raised serialization failure (SQLSTATE 40001) on every attempt.
          await tx.$executeRawUnsafe(
            "DO $$ BEGIN RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001'; END $$",
          );
        },
        { maxRetries: 2 },
      ),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('INTERNAL_ERROR');
    expect((err as AppError).retryable).toBe(true);
    // 1 attempt + 2 retries.
    expect(attempts).toBe(3);
  });

  it('pgCode reads the SQLSTATE of real driver errors (40P01, 23505, 23514)', async () => {
    const deadlockLike = await captureError(() =>
      testPrisma.$executeRawUnsafe(
        "DO $$ BEGIN RAISE EXCEPTION 'deadlock' USING ERRCODE = '40P01'; END $$",
      ),
    );
    expect(pgCode(deadlockLike)).toBe('40P01');

    await seedUser('dupuser');
    const unique = await captureError(() => seedUser('dupuser'));
    expect(pgCode(unique)).toBe('23505');

    const walletId = await seedWallet(0n);
    const check = await captureError(() =>
      testPrisma.$executeRaw`UPDATE "Wallet" SET "balance" = -1 WHERE "id" = ${walletId}::uuid`,
    );
    expect(pgCode(check)).toBe('23514');

    expect(pgCode(new Error('plain'))).toBeUndefined();
  });

  it('pool max 5: 20 parallel withTx all finish without a maxWait error', async () => {
    // Own client with max 5 on purpose: .env.test sets DB_POOL_MAX=20, which would hide pool waits.
    const pool = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '', max: 5 }),
    });
    try {
      const results = await raceAll(
        Array.from({ length: 20 }, (_, i) => () =>
          withTx(pool, async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(0.05)`;
            return i;
          }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      expect(failed.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    } finally {
      await pool.$disconnect();
    }
  });
});
