import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { RATE_LIMITER } from '../../src/auth/ip-rate-limit.guard.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { raceAll } from '../helpers/race.js';

const LOOPBACK = '127.0.0.1';

describe('guest daily limit under real concurrency (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let baseUrl = '';

  beforeEach(async () => {
    await resetDb();
    // The per-minute IP limiter is not under test here: 15 requests from one IP would trip it.
    // The daily limit (guestsPerIpPerDay, counted in the DB) is what this test exercises.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RATE_LIMITER)
      .useValue({ take: () => ({ ok: true }) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, LOOPBACK);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://${LOOPBACK}:${port}/api/v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('15 lời gọi song song cùng IP: đúng 10 thành công, 5 bị RATE_LIMITED', async () => {
    const settled = await raceAll(
      Array.from({ length: 15 }, (_, i) => async () => {
        const res = await fetch(`${baseUrl}/auth/guest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName: `Khach ${String(i).padStart(2, '0')}`, avatarId: 'avatar_01' }),
        });
        return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
      }),
    );

    const failures = settled.filter((s) => s.status === 'rejected');
    expect(failures, 'every request must get an HTTP response').toHaveLength(0);
    const results = settled.map((s) => (s as PromiseFulfilledResult<{ status: number; body: { error?: { code: string } } }>).value);
    const ok = results.filter((r) => r.status < 300);
    const limited = results.filter((r) => r.body.error?.code === 'RATE_LIMITED');
    expect(ok).toHaveLength(10);
    expect(limited).toHaveLength(5);

    expect(await testPrisma.user.count()).toBe(10);
    expect(await testPrisma.wallet.count()).toBe(10);
    expect(await testPrisma.playerProfile.count()).toBe(10);
    expect(await testPrisma.auditLog.count({ where: { action: 'AUTH_GUEST_CREATED' } })).toBe(10);
  });
});
