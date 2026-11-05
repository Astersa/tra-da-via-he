import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { resetDb, seedGuest, seedUser, testPrisma } from '../helpers/db.js';
import { raceAll } from '../helpers/race.js';

const LOOPBACK = '127.0.0.1';
const PASSWORD = 'matkhau123';
const SECRET = process.env.JWT_SECRET ?? '';

describe('POST /auth/upgrade under real concurrency (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let baseUrl = '';

  beforeEach(async () => {
    await resetDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, LOOPBACK);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://${LOOPBACK}:${port}/api/v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  // Guests are seeded directly; the upgrade path does not need a profile or wallet to run.
  async function guestWithToken(): Promise<{ id: string; token: string }> {
    const g = await seedGuest();
    return { id: g.id, token: await signAccessToken(SECRET, g.id) };
  }

  const upgrade = async (token: string, username: string) => {
    const res = await fetch(`${baseUrl}/auth/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    return { status: res.status, body: (await res.json()) as { user?: { id: string }; error?: { code: string } } };
  };

  const fulfilled = <T>(settled: PromiseSettledResult<T>[]): T[] =>
    settled.map((s) => {
      if (s.status === 'rejected') throw new Error(`request did not get an HTTP response: ${String(s.reason)}`);
      return s.value;
    });

  it('2 user cùng nâng cấp một username song song: đúng 1 OK, 1 USERNAME_TAKEN', async () => {
    const a = await guestWithToken();
    const b = await guestWithToken();

    const results = fulfilled(
      await raceAll([() => upgrade(a.token, 'mot_ten_chung'), () => upgrade(b.token, 'mot_ten_chung')]),
    );

    const ok = results.filter((r) => r.status === 200);
    const taken = results.filter((r) => r.status === 409 && r.body.error?.code === 'USERNAME_TAKEN');
    expect(ok).toHaveLength(1);
    expect(taken).toHaveLength(1);

    const winner = ok[0].body.user?.id;
    const registered = await testPrisma.user.findMany({ where: { kind: 'REGISTERED' } });
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe(winner);
    expect(registered[0].username).toBe('mot_ten_chung');

    // The loser is still a clean guest: no username and no password hash were left behind.
    const loserId = winner === a.id ? b.id : a.id;
    const loser = await testPrisma.user.findUniqueOrThrow({ where: { id: loserId } });
    expect(loser.kind).toBe('GUEST');
    expect(loser.username).toBeNull();
    expect(loser.passwordHash).toBeNull();
  });

  it('1 user gửi 2 nâng cấp song song với username khác nhau: đúng 1 OK, 1 ALREADY_REGISTERED', async () => {
    const a = await guestWithToken();

    const results = fulfilled(
      await raceAll([() => upgrade(a.token, 'ten_thu_nhat'), () => upgrade(a.token, 'ten_thu_hai')]),
    );

    const ok = results.filter((r) => r.status === 200);
    const already = results.filter((r) => r.status === 409 && r.body.error?.code === 'ALREADY_REGISTERED');
    expect(ok).toHaveLength(1);
    expect(already).toHaveLength(1);

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.kind).toBe('REGISTERED');
    expect(['ten_thu_nhat', 'ten_thu_hai']).toContain(row.username);
    expect(await testPrisma.user.count({ where: { kind: 'REGISTERED' } })).toBe(1);
  });

  it('username đã có người dùng khác giữ: nâng cấp song song từ 2 khách đều USERNAME_TAKEN', async () => {
    await seedUser('da_co_chu');
    const a = await guestWithToken();
    const b = await guestWithToken();

    const results = fulfilled(
      await raceAll([() => upgrade(a.token, 'da_co_chu'), () => upgrade(b.token, 'da_co_chu')]),
    );
    expect(results.map((r) => r.body.error?.code)).toEqual(['USERNAME_TAKEN', 'USERNAME_TAKEN']);
    expect(await testPrisma.user.count({ where: { kind: 'REGISTERED' } })).toBe(1);
  });
});
