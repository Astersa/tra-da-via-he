import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CLOCK, type Clock } from '../../src/core/clock.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { resetDb, testPrisma } from '../helpers/db.js';

const LOOPBACK = '127.0.0.1';
const COOKIE = 'tdvh_refresh';
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-11-05T02:00:00.000Z');

// Controllable clock: fixedNow = null means real time.
let fixedNow: Date | null = null;
const clock: Clock = { now: () => (fixedNow ? new Date(fixedNow.getTime()) : new Date()) };
const setNow = (d: Date): void => {
  fixedNow = d;
};
const at = (ms: number): Date => new Date(T0.getTime() + ms);

let app: INestApplication | undefined;
let baseUrl = '';

async function startApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://${LOOPBACK}:${port}/api/v1`;
}

async function stopApp(): Promise<void> {
  await app?.close();
  app = undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; body: any; setCookie: string[] };

async function send(method: 'GET' | 'POST', path: string, opts: { body?: unknown; cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie !== undefined) headers.cookie = `${COOKIE}=${opts.cookie}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookie: res.headers.getSetCookie(),
  };
}

// Raw refresh token from the Set-Cookie header, or undefined when no tdvh_refresh cookie was set.
function refreshOf(res: Res): string | undefined {
  const line = res.setCookie.find((c) => c.startsWith(`${COOKIE}=`));
  return line?.slice(COOKIE.length + 1).split(';')[0];
}

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

async function guest(displayName: string): Promise<Res> {
  return send('POST', '/auth/guest', { body: { displayName, avatarId: 'avatar_01' } });
}

async function login(username: string, password: string): Promise<Res> {
  return send('POST', '/auth/login', { body: { username, password } });
}

async function refresh(raw: string | undefined): Promise<Res> {
  return send('POST', '/auth/refresh', { cookie: raw });
}

async function seedRegistered(username: string, password: string) {
  const passwordHash = await new PasswordService().hash(password);
  return testPrisma.user.create({ data: { kind: 'REGISTERED', username, passwordHash } });
}

async function tokensOf(userId: string) {
  return testPrisma.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

beforeEach(async () => {
  await resetDb();
  fixedNow = null;
  await startApp();
});

afterEach(async () => {
  await stopApp();
  fixedNow = null;
});

describe('cookie tdvh_refresh', () => {
  it('guest và login đặt cookie httpOnly, SameSite=Lax, Path=/api/v1/auth, không Secure ngoài production', async () => {
    const g = await guest('Cookie Mot');
    const line = g.setCookie.find((c) => c.startsWith(`${COOKIE}=`)) ?? '';
    expect(line).not.toBe('');
    const attrs = line.toLowerCase();
    expect(attrs).toContain('httponly');
    expect(attrs).toContain('samesite=lax');
    expect(attrs).toContain('path=/api/v1/auth');
    expect(attrs).not.toContain('secure');

    await seedRegistered('cookie_reg', 'matkhau123');
    const l = await login('cookie_reg', 'matkhau123');
    const loginLine = (l.setCookie.find((c) => c.startsWith(`${COOKIE}=`)) ?? '').toLowerCase();
    expect(loginLine).toContain('httponly');
    expect(loginLine).toContain('samesite=lax');
    expect(loginLine).toContain('path=/api/v1/auth');
    expect(loginLine).not.toContain('secure');
  });

  it('thêm Secure khi NODE_ENV=production cho cả guest và login', async () => {
    await seedRegistered('secure_reg', 'matkhau123');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const g = await guest('Cookie Secure');
      expect((g.setCookie.find((c) => c.startsWith(`${COOKIE}=`)) ?? '').toLowerCase()).toContain('secure');
      const l = await login('secure_reg', 'matkhau123');
      expect((l.setCookie.find((c) => c.startsWith(`${COOKIE}=`)) ?? '').toLowerCase()).toContain('secure');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('DB chỉ lưu sha256 của token, không lưu token thô', async () => {
    const g = await guest('Cookie Hash');
    const raw = refreshOf(g);
    expect(raw).toBeDefined();
    expect(raw!.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    const rows = await tokensOf(g.body.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(raw!));
    expect(JSON.stringify(await testPrisma.refreshToken.findMany())).not.toContain(raw!);
  });
});

describe('POST /auth/refresh', () => {
  it('xoay vòng: token cũ thu hồi kèm replacedBy, token mới còn hiệu lực, cookie mới khác cookie cũ', async () => {
    const g = await guest('Xoay Vong');
    const a = refreshOf(g)!;
    const r = await refresh(a);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(['accessToken']);
    expect(typeof r.body.accessToken).toBe('string');
    const b = refreshOf(r)!;
    expect(b).toBeDefined();
    expect(b).not.toBe(a);

    const rows = await tokensOf(g.body.user.id);
    expect(rows).toHaveLength(2);
    const oldRow = rows.find((x) => x.tokenHash === sha256(a))!;
    const newRow = rows.find((x) => x.tokenHash === sha256(b))!;
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedBy).toBe(newRow.id);
    expect(newRow.revokedAt).toBeNull();
  });

  it('thời điểm thu hồi và hạn dùng lấy từ Clock', async () => {
    setNow(T0);
    const g = await guest('Clock Dung');
    const a = refreshOf(g)!;
    const r = await refresh(a);
    expect(r.status).toBe(200);
    const rows = await tokensOf(g.body.user.id);
    const oldRow = rows.find((x) => x.tokenHash === sha256(a))!;
    const newRow = rows.find((x) => x.tokenHash !== sha256(a))!;
    expect(oldRow.revokedAt?.getTime()).toBe(T0.getTime());
    expect(newRow.expiresAt.getTime()).toBe(T0.getTime() + 30 * DAY_MS);
  });

  it('thiếu cookie hoặc token sai: 401 UNAUTHENTICATED', async () => {
    const none = await refresh(undefined);
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('UNAUTHENTICATED');

    const bad = await refresh('khong-ton-tai-token');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
    expect(bad.setCookie).toHaveLength(0);
  });

  it('token hết hạn bị từ chối và không tạo token mới', async () => {
    const g = await guest('Het Han');
    const a = refreshOf(g)!;
    await testPrisma.refreshToken.updateMany({
      where: { tokenHash: sha256(a) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await refresh(a);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    expect(r.setCookie).toHaveLength(0);
    expect(await tokensOf(g.body.user.id)).toHaveLength(1);
  });

  it('user bị ban bị từ chối và không tạo token mới', async () => {
    const g = await guest('Bi Ban');
    const a = refreshOf(g)!;
    await testPrisma.user.update({ where: { id: g.body.user.id }, data: { bannedAt: new Date() } });
    const r = await refresh(a);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    expect(r.setCookie).toHaveLength(0);
    expect(await tokensOf(g.body.user.id)).toHaveLength(1);
  });

  it('logout làm mất hiệu lực: 204, sau đó refresh bằng cookie cũ bị 401', async () => {
    const g = await guest('Logout Mot');
    const a = refreshOf(g)!;
    const out = await send('POST', '/auth/logout', { cookie: a });
    expect(out.status).toBe(204);
    const r = await refresh(a);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('dùng lại token cũ sau 31 giây: 401, mọi token của user bị thu hồi (commit dù trả lỗi)', async () => {
    setNow(T0);
    const g = await guest('Dung Lai');
    const a = refreshOf(g)!;
    const first = await refresh(a);
    expect(first.status).toBe(200);
    const b = refreshOf(first)!;

    setNow(at(31_000));
    const reuse = await refresh(a);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED');

    // The revocation of the live token must persist after the error response.
    const rowB = await testPrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(b) } });
    expect(rowB.revokedAt).not.toBeNull();
    expect(await testPrisma.refreshToken.count({ where: { userId: g.body.user.id, revokedAt: null } })).toBe(0);
    const again = await refresh(b);
    expect(again.status).toBe(401);
  });

  it('dùng lại token cũ sau 29 giây: 200, token kế tiếp bị thu hồi, token khác của user không bị ảnh hưởng', async () => {
    await seedRegistered('grace_reg', 'matkhau123');
    setNow(T0);
    const la = await login('grace_reg', 'matkhau123');
    const a = refreshOf(la)!;
    const lc = await login('grace_reg', 'matkhau123');
    const c = refreshOf(lc)!;
    const userId = la.body.user.id as string;

    const first = await refresh(a);
    expect(first.status).toBe(200);
    const b = refreshOf(first)!;

    setNow(at(29_000));
    const replay = await refresh(a);
    expect(replay.status).toBe(200);
    expect(typeof replay.body.accessToken).toBe('string');
    const n = refreshOf(replay)!;
    expect(n).not.toBe(b);

    const rowB = await testPrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(b) } });
    const rowN = await testPrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(n) } });
    const rowA = await testPrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(a) } });
    expect(rowB.revokedAt).not.toBeNull();
    expect(rowN.revokedAt).toBeNull();
    expect(rowA.replacedBy).toBe(rowN.id);

    // The other session of the same user is untouched.
    const rowC = await testPrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(c) } });
    expect(rowC.revokedAt).toBeNull();
    expect(await testPrisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(2);
    expect((await refresh(c)).status).toBe(200);
  });

  it('2 refresh song song cùng token: cả hai trả 200 và đúng một token của chuỗi còn hiệu lực', async () => {
    const g = await guest('Song Song');
    const a = refreshOf(g)!;
    const [r1, r2] = await Promise.all([refresh(a), refresh(a)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const live = await testPrisma.refreshToken.findMany({
      where: { userId: g.body.user.id, revokedAt: null },
    });
    expect(live).toHaveLength(1);
    const hashes = [refreshOf(r1)!, refreshOf(r2)!].map(sha256);
    expect(hashes).toContain(live[0].tokenHash);
  });
});
