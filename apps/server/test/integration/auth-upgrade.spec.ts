import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AppError } from '../../src/core/errors.js';
import { resetDb, seedGuest, seedUser, testPrisma } from '../helpers/db.js';

const LOOPBACK = '127.0.0.1';
const PASSWORD = 'matkhau123';

let app: INestApplication | undefined;
let baseUrl = '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; body: any; setCookie: string[] };

async function startApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://${LOOPBACK}:${port}/api/v1`;
}

async function send(method: 'GET' | 'POST', path: string, opts: { body?: unknown; token?: string; cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.getSetCookie() };
}

const guest = (displayName: string): Promise<Res> =>
  send('POST', '/auth/guest', { body: { displayName, avatarId: 'avatar_01' } });

const upgrade = (token: string, username: string, password = PASSWORD): Promise<Res> =>
  send('POST', '/auth/upgrade', { token, body: { username, password } });

const login = (username: string, password: string): Promise<Res> =>
  send('POST', '/auth/login', { body: { username, password } });

// Name=value part of the refresh cookie, as a browser would send it back.
const cookieOf = (res: Res): string => res.setCookie.map((c) => c.split(';')[0]).join('; ');

beforeEach(async () => {
  await resetDb();
  await startApp();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

afterAll(async () => {
  await app?.close();
});

describe('POST /auth/upgrade', () => {
  it('nâng cấp giữ nguyên id, tên, nhân vật, ví; kind REGISTERED; username lưu lowercase', async () => {
    const g = await guest('Khach Nang Cap');
    const before = await testPrisma.user.findUniqueOrThrow({
      where: { id: g.body.user.id },
      include: { profile: true, wallet: true },
    });

    const res = await upgrade(g.body.accessToken, '  Tra_Da_1 ');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(g.body.user.id);
    expect(res.body.user.kind).toBe('REGISTERED');
    expect(res.body.user.username).toBe('tra_da_1');
    expect(typeof res.body.accessToken).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: g.body.user.id },
      include: { profile: true, wallet: true },
    });
    expect(after.kind).toBe('REGISTERED');
    expect(after.username).toBe('tra_da_1');
    expect(after.passwordHash).not.toBeNull();
    expect(after.profile?.displayName).toBe(before.profile?.displayName);
    expect(after.profile?.avatarId).toBe(before.profile?.avatarId);
    expect(after.wallet?.id).toBe(before.wallet?.id);
    expect(after.wallet?.balance).toBe(before.wallet?.balance);
    expect(after.wallet?.heldBalance).toBe(before.wallet?.heldBalance);
    expect(after.wallet?.version).toBe(before.wallet?.version);
    expect(await testPrisma.wallet.count()).toBe(1);
    expect(await testPrisma.walletTransaction.count()).toBe(0);
  });

  it('sau nâng cấp đăng nhập được bằng username và mật khẩu mới; token cũ và refresh cũ vẫn dùng được', async () => {
    const g = await guest('Khach Dang Nhap');
    expect((await upgrade(g.body.accessToken, 'nguoi_moi')).status).toBe(200);

    const loggedIn = await login('nguoi_moi', PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.user.id).toBe(g.body.user.id);

    const me = await send('GET', '/me', { token: g.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.user.kind).toBe('REGISTERED');

    const refreshed = await send('POST', '/auth/refresh', { cookie: cookieOf(g) });
    expect(refreshed.status).toBe(200);
  });

  it('nâng cấp lần 2 cùng user trả ALREADY_REGISTERED và không đổi gì', async () => {
    const g = await guest('Khach Hai Lan');
    expect((await upgrade(g.body.accessToken, 'lan_mot')).status).toBe(200);

    const second = await upgrade(g.body.accessToken, 'lan_hai');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_REGISTERED');

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: g.body.user.id } });
    expect(row.username).toBe('lan_mot');
    expect(await testPrisma.user.count({ where: { username: 'lan_hai' } })).toBe(0);
  });

  it('username trùng khác hoa thường trả USERNAME_TAKEN, khách vẫn là GUEST không có username hay passwordHash', async () => {
    await seedUser('alice_x');
    const g = await guest('Khach Trung Ten');

    const res = await upgrade(g.body.accessToken, 'Alice_X');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: g.body.user.id } });
    expect(row.kind).toBe('GUEST');
    expect(row.username).toBeNull();
    expect(row.passwordHash).toBeNull();
  });

  it('thiếu token trả 401 UNAUTHENTICATED; token sai trả 401', async () => {
    const noToken = await send('POST', '/auth/upgrade', { body: { username: 'khong_co', password: PASSWORD } });
    expect(noToken.status).toBe(401);
    expect(noToken.body.error.code).toBe('UNAUTHENTICATED');

    const badToken = await upgrade('khong.phai.jwt', 'khong_co');
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('dữ liệu sai (username quá ngắn, mật khẩu dưới 8 ký tự) trả VALIDATION_FAILED', async () => {
    const g = await guest('Khach Sai Du Lieu');
    const shortName = await upgrade(g.body.accessToken, 'ab');
    expect(shortName.status).toBe(400);
    expect(shortName.body.error.code).toBe('VALIDATION_FAILED');

    const shortPass = await upgrade(g.body.accessToken, 'hop_le_1', 'abc1234');
    expect(shortPass.status).toBe(400);
    expect(shortPass.body.error.code).toBe('VALIDATION_FAILED');

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: g.body.user.id } });
    expect(row.kind).toBe('GUEST');
  });

  it('vượt 5 yêu cầu mỗi phút mỗi IP trả 429 RATE_LIMITED', async () => {
    const g = await guest('Khach Gioi Han');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await upgrade(g.body.accessToken, 'gioi_han_1')).status);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(1)).toEqual([409, 409, 409, 409]);

    const sixth = await upgrade(g.body.accessToken, 'gioi_han_1');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('assertRegistered (core/account-guard.ts)', () => {
  it('ném ACCOUNT_REQUIRED với user GUEST đọc từ DB', async () => {
    const { assertRegistered } = await import('../../src/core/account-guard.js');
    const guestRow = await seedGuest();
    const err = await assertRegistered(testPrisma, guestRow.id).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ACCOUNT_REQUIRED');
  });

  it('không ném với user REGISTERED', async () => {
    const { assertRegistered } = await import('../../src/core/account-guard.js');
    const reg = await seedUser('da_dang_ky');
    await expect(assertRegistered(testPrisma, reg.id)).resolves.toBeUndefined();
  });
});
