import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthResSchema } from '@tdvh/shared';
import { jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { IpRateLimit, IpRateLimitGuard, RATE_LIMITER } from '../../src/auth/ip-rate-limit.guard.js';
import { InMemoryRateLimiter } from '../../src/core/rate-limiter.js';
import { startOfVnDay } from '../../src/core/clock.js';
import { PrismaService } from '../../src/core/prisma.service.js';
import { resetDb, testPrisma } from '../helpers/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';
const DAY_MS = 24 * 60 * 60 * 1000;

// ipHash = sha256(ip + ':' + JWT_SECRET) (IMPLEMENTATION-PLAN.md §3.6.4).
const ipHashOf = (ip: string): string => createHash('sha256').update(`${ip}:${SECRET}`).digest('hex');

let app: INestApplication | undefined;
let baseUrl = '';

// A fresh app gets a fresh in-memory rate limiter, like a fresh process after restart.
async function startApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
type Res = { status: number; body: any };

async function post(path: string, body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const guest = (displayName: string, avatarId = 'avatar_01'): Promise<Res> =>
  post('/auth/guest', { displayName, avatarId });

const login = (username: string, password: string): Promise<Res> => post('/auth/login', { username, password });

async function seedRegistered(username: string, password: string) {
  const passwordHash = await new PasswordService().hash(password);
  return testPrisma.user.create({ data: { kind: 'REGISTERED', username, passwordHash } });
}

// Simulates guests already created today from one IP (rows as the service writes them).
async function seedGuestAudit(ipHash: string, createdAt: Date, n: number): Promise<void> {
  await testPrisma.auditLog.createMany({
    data: Array.from({ length: n }, () => ({
      action: 'AUTH_GUEST_CREATED',
      targetType: 'User',
      targetId: randomUUID(),
      metadata: { ipHash },
      createdAt,
    })),
  });
}

beforeEach(async () => {
  await resetDb();
  await startApp();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await stopApp();
});

describe('POST /auth/guest', () => {
  it('tạo khách: kind GUEST, username null, có access token, profile và ví số dư 0', async () => {
    const res = await guest('Trà Đá Một');
    expect(res.status).toBe(201);
    expect(() => AuthResSchema.parse(res.body)).not.toThrow();
    expect(res.body.user.kind).toBe('GUEST');
    expect(res.body.user.username).toBeNull();
    expect(typeof res.body.accessToken).toBe('string');

    const row = await testPrisma.user.findUniqueOrThrow({
      where: { id: res.body.user.id },
      include: { profile: true, wallet: true },
    });
    expect(row.kind).toBe('GUEST');
    expect(row.profile?.displayName).toBe('Trà Đá Một');
    expect(row.wallet?.balance).toBe(0n);
    expect(row.wallet?.heldBalance).toBe(0n);
  });

  it('access token là JWT HS256 với sub = userId và hạn 15 phút', async () => {
    const res = await guest('Khach Token');
    const { payload, protectedHeader } = await jwtVerify(
      res.body.accessToken,
      new TextEncoder().encode(SECRET),
      { algorithms: ['HS256'] },
    );
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe(res.body.user.id);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(15 * 60);
  });

  it('tên trùng khác dấu trả DISPLAY_NAME_TAKEN', async () => {
    expect((await guest('Trà Đá Một')).status).toBeLessThan(300);
    const dup = await guest('Tra Da Mot');
    expect(dup.body.error.code).toBe('DISPLAY_NAME_TAKEN');
  });

  it('tạo khách thất bại không để lại dòng nào', async () => {
    await guest('Trà Đá Hai');
    const dup = await guest('Tra Da Hai');
    expect(dup.body.error.code).toBe('DISPLAY_NAME_TAKEN');
    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.wallet.count()).toBe(1);
    expect(await testPrisma.playerProfile.count()).toBe(1);
    expect(await testPrisma.auditLog.count({ where: { action: 'AUTH_GUEST_CREATED' } })).toBe(1);
  });

  it('mỗi user đúng một ví', async () => {
    const res = await guest('Khach Vi');
    const wallets = await testPrisma.wallet.findMany({ where: { userId: res.body.user.id } });
    expect(wallets).toHaveLength(1);
    expect(await testPrisma.wallet.count()).toBe(await testPrisma.user.count());
  });

  it('response không có passwordHash; IP thô không được ghi vào DB', async () => {
    const res = await guest('Khach Kin');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['createdAt', 'id', 'kind', 'mutedUntil', 'role', 'username'].sort(),
    );
    const dump = JSON.stringify({
      users: await testPrisma.user.findMany(),
      profiles: await testPrisma.playerProfile.findMany(),
      audit: await testPrisma.auditLog.findMany(),
    }, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    expect(dump).not.toContain(LOOPBACK);
    expect(dump).toContain(ipHashOf(LOOPBACK));
  });

  it('rate limit theo IP: khách thứ 6 trong một phút trả RATE_LIMITED có retryAfterMs', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await guest(`Khach Nhip ${i}`)).status).toBeLessThan(300);
    }
    const limited = await guest('Khach Nhip Sau');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    const retryAfterMs = limited.body.error.details?.retryAfterMs;
    expect(typeof retryAfterMs).toBe('number');
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('giới hạn theo ngày đếm trong DB: 10 khách đã có hôm nay thì khách thứ 11 bị RATE_LIMITED dài hạn', async () => {
    await seedGuestAudit(ipHashOf(LOOPBACK), new Date(), 10);
    const res = await guest('Khach Thu Muoi Mot');
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.retryAfterMs).toBeGreaterThan(60_000);
    expect(res.body.error.details.retryAfterMs).toBeLessThanOrEqual(DAY_MS);
  });

  it('khách của IP khác không được tính vào giới hạn ngày của IP này', async () => {
    await seedGuestAudit(ipHashOf('10.0.0.9'), new Date(), 10);
    expect((await guest('Khach Ip Khac')).status).toBeLessThan(300);
  });

  it('qua 00:00 giờ VN thì được tạo lại', async () => {
    await seedGuestAudit(ipHashOf(LOOPBACK), new Date(startOfVnDay(new Date()).getTime() - 1000), 10);
    expect((await guest('Khach Sang Ngay Moi')).status).toBeLessThan(300);
  });

  it('khởi động lại app vẫn giữ số đếm theo ngày (đếm trong DB)', async () => {
    await stopApp();
    for (const batch of ['A', 'B']) {
      await startApp();
      for (let i = 0; i < 5; i++) {
        expect((await guest(`Khach ${batch} ${i}`)).status).toBeLessThan(300);
      }
      await stopApp();
    }
    await startApp();
    const res = await guest('Khach Sau Khi');
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.retryAfterMs).toBeGreaterThan(60_000);
  });

  it('displayName hoặc avatarId sai trả VALIDATION_FAILED', async () => {
    expect((await guest('a')).body.error.code).toBe('VALIDATION_FAILED');
    expect((await guest('Khach Hop Le', 'avatar_99')).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('lỗi không lường trước trả INTERNAL_ERROR và không lộ message', async () => {
    vi.spyOn(PrismaService.prototype, '$transaction').mockRejectedValueOnce(new Error('boom-secret-detail'));
    const res = await guest('Khach Loi Ngam');
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('boom-secret-detail');
  });
});

describe('POST /auth/login', () => {
  it('đăng nhập đúng trả accessToken và user REGISTERED', async () => {
    const user = await seedRegistered('nguoi_choi', 'matkhau-dung-1');
    const res = await login('nguoi_choi', 'matkhau-dung-1');
    expect(res.status).toBe(200);
    expect(() => AuthResSchema.parse(res.body)).not.toThrow();
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.kind).toBe('REGISTERED');
    expect(res.body.user.username).toBe('nguoi_choi');
  });

  it('username khác hoa thường vẫn đăng nhập được', async () => {
    await seedRegistered('nguoi_choi_hoa', 'matkhau-dung-1');
    const res = await login('NGUOI_CHOI_HOA', 'matkhau-dung-1');
    expect(res.body.user.username).toBe('nguoi_choi_hoa');
  });

  it('sai mật khẩu và username không tồn tại cùng trả INVALID_CREDENTIALS với cùng nội dung', async () => {
    await seedRegistered('nguoi_that', 'matkhau-dung-1');
    const wrongPass = await login('nguoi_that', 'matkhau-sai-1');
    const noUser = await login('nguoi_khong_co', 'matkhau-dung-1');
    expect(wrongPass.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(noUser.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(noUser.body).toEqual(wrongPass.body);
  });

  it('không có user thì vẫn verify đúng một lần (tốn thời gian tương đương)', async () => {
    const spy = vi.spyOn(PasswordService.prototype, 'verify');
    await login('nguoi_khong_co', 'matkhau-dung-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sai mật khẩu cũng verify đúng một lần', async () => {
    await seedRegistered('nguoi_verify', 'matkhau-dung-1');
    const spy = vi.spyOn(PasswordService.prototype, 'verify');
    await login('nguoi_verify', 'matkhau-sai-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('khách (GUEST) không đăng nhập được', async () => {
    const created = await guest('Khach Khong Dang Nhap');
    const res = await login('khach_khong_dang', 'matkhau-dung-1');
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(created.body.user.username).toBeNull();
  });

  it('response đăng nhập không có passwordHash', async () => {
    await seedRegistered('nguoi_kin', 'matkhau-dung-1');
    const res = await login('nguoi_kin', 'matkhau-dung-1');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('password rỗng trả VALIDATION_FAILED', async () => {
    const res = await login('nguoi_choi', '');
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('PasswordService', () => {
  it('hash dùng Argon2id với tham số §3.10.7 và verify đúng/sai', async () => {
    const svc = new PasswordService();
    const hash = await svc.hash('matkhau-dung-1');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await svc.verify(hash, 'matkhau-dung-1')).toBe(true);
    expect(await svc.verify(hash, 'matkhau-sai-1')).toBe(false);
  });

  it('một lần băm dưới 2 giây', async () => {
    const start = performance.now();
    await new PasswordService().hash('matkhau-do-thoi-gian');
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('/auth/register', () => {
  it('không tồn tại: trả 404', async () => {
    const res = await post('/auth/register', { username: 'nguoi_moi', password: 'matkhau-dung-1' });
    expect(res.status).toBe(404);
  });
});

describe('JWT_SECRET khi khởi động', () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('thiếu JWT_SECRET thì app không khởi động', async () => {
    delete process.env.JWT_SECRET;
    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
  });

  it('JWT_SECRET dưới 32 ký tự thì app không khởi động', async () => {
    process.env.JWT_SECRET = 'x'.repeat(31);
    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
  });
});

describe('IpRateLimitGuard', () => {
  class Probe {
    @IpRateLimit(2, 1)
    handle(): void {}
  }

  async function guardWithLimiter() {
    const moduleRef = await Test.createTestingModule({
      providers: [IpRateLimitGuard, { provide: RATE_LIMITER, useClass: InMemoryRateLimiter }],
    }).compile();
    return moduleRef.get(IpRateLimitGuard);
  }

  const ctx = (ip: string, headers: Record<string, string> = {}): ExecutionContext =>
    ({
      getHandler: () => Probe.prototype.handle,
      getClass: () => Probe,
      switchToHttp: () => ({ getRequest: () => ({ ip, method: 'POST', route: { path: '/auth/guest' }, headers }) }),
    }) as unknown as ExecutionContext;

  it('IP khác không bị ảnh hưởng và chỉ đọc req.ip, không đọc X-Forwarded-For', async () => {
    const guard = await guardWithLimiter();
    expect(guard.canActivate(ctx('1.1.1.1'))).toBe(true);
    expect(guard.canActivate(ctx('1.1.1.1', { 'x-forwarded-for': '9.9.9.9' }))).toBe(true);
    let thrown: unknown;
    try {
      guard.canActivate(ctx('1.1.1.1', { 'x-forwarded-for': '8.8.8.8' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('RATE_LIMITED');
    expect(guard.canActivate(ctx('2.2.2.2'))).toBe(true);
  });
});
