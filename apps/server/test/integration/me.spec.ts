import type { AddressInfo } from 'node:net';
import { Controller, Get, Module, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { displayNameKey, MeResSchema, PatchProfileResSchema } from '@tdvh/shared';
import { SignJWT, UnsecuredJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { JwtGuard, Roles, RolesGuard } from '../../src/core/jwt.guard.js';
import { JWT_SECRET, signAccessToken } from '../../src/core/jwt.js';
import { PrismaModule } from '../../src/core/prisma.module.js';
import { resetDb, testPrisma } from '../helpers/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
const OTHER_SECRET = 'another-secret-that-is-not-ours-0000000000000000';
const LOOPBACK = '127.0.0.1';

// Test-only route guarded by @Roles('ADMIN'). No product route exists for it yet.
@Controller('probe')
@UseGuards(JwtGuard, RolesGuard)
class AdminProbeController {
  @Get('admin')
  @Roles('ADMIN')
  admin(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [AdminProbeController],
  providers: [{ provide: JWT_SECRET, useFactory: () => SECRET }],
})
class AdminProbeModule {}

let app: INestApplication | undefined;
let baseUrl = '';

async function startApp(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, AdminProbeModule] }).compile();
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
type Res = { status: number; text: string; body: any };

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

const get = (path: string, token?: string) => call('GET', path, { token });
const patch = (path: string, token: string | undefined, body: unknown) => call('PATCH', path, { token, body });

function expectError(res: Res, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body?.error?.code).toBe(code);
}

// Guest with profile and wallet, written directly. POST /auth/guest is rate limited per IP.
async function seedGuestWithProfile(displayName: string) {
  return testPrisma.user.create({
    data: {
      kind: 'GUEST',
      wallet: { create: {} },
      profile: { create: { displayName, displayNameKey: displayNameKey(displayName) } },
    },
  });
}

async function seedRegisteredWithProfile(username: string, displayName: string, role: 'PLAYER' | 'ADMIN' = 'PLAYER') {
  return testPrisma.user.create({
    data: {
      kind: 'REGISTERED',
      role,
      username,
      passwordHash: 'test-hash',
      wallet: { create: {} },
      profile: { create: { displayName, displayNameKey: displayNameKey(displayName) } },
    },
  });
}

const tokenFor = (userId: string): Promise<string> => signAccessToken(SECRET, userId);

async function expiredTokenFor(userId: string): Promise<string> {
  const past = Math.floor(Date.now() / 1000) - 120;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(past - 900)
    .setExpirationTime(past)
    .sign(new TextEncoder().encode(SECRET));
}

function wrongKeyTokenFor(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(OTHER_SECRET));
}

function algNoneTokenFor(userId: string): string {
  return new UnsecuredJWT({}).setSubject(userId).setIssuedAt().setExpirationTime('15m').encode();
}

// Valid signature, but claims role ADMIN and kind REGISTERED. The guard must ignore them.
function forgedClaimsTokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: 'ADMIN', kind: 'REGISTERED' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(async () => {
  await resetDb();
  await startApp();
});

afterEach(async () => {
  await stopApp();
});

describe('JwtGuard: token', () => {
  it('thiếu token: 401 UNAUTHENTICATED', async () => {
    expectError(await get('/me'), 401, 'UNAUTHENTICATED');
  });

  it('token rác: 401 UNAUTHENTICATED', async () => {
    expectError(await get('/me', 'not-a-jwt'), 401, 'UNAUTHENTICATED');
  });

  it('token ký bằng khóa khác: 401 UNAUTHENTICATED', async () => {
    const user = await seedGuestWithProfile('Khách ký sai');
    expectError(await get('/me', await wrongKeyTokenFor(user.id)), 401, 'UNAUTHENTICATED');
  });

  it('alg none: 401 UNAUTHENTICATED', async () => {
    const user = await seedGuestWithProfile('Khách alg none');
    expectError(await get('/me', algNoneTokenFor(user.id)), 401, 'UNAUTHENTICATED');
  });

  it('token hết hạn: 401 TOKEN_EXPIRED', async () => {
    const user = await seedGuestWithProfile('Khách hết hạn');
    expectError(await get('/me', await expiredTokenFor(user.id)), 401, 'TOKEN_EXPIRED');
  });

  it('sub không phải UUID: 401 UNAUTHENTICATED', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-a-uuid')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(SECRET));
    expectError(await get('/me', token), 401, 'UNAUTHENTICATED');
  });

  it('user không tồn tại: 401 UNAUTHENTICATED', async () => {
    const token = await tokenFor('00000000-0000-4000-8000-000000000000');
    expectError(await get('/me', token), 401, 'UNAUTHENTICATED');
  });

  it('user bị ban: 401 UNAUTHENTICATED', async () => {
    const user = await seedGuestWithProfile('Khách bị ban');
    await testPrisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });
    expectError(await get('/me', await tokenFor(user.id)), 401, 'UNAUTHENTICATED');
  });

  it('role và kind trong claim bị bỏ qua, đọc từ DB', async () => {
    const player = await seedRegisteredWithProfile('player_forge', 'Người chơi giả');
    const token = await forgedClaimsTokenFor(player.id);
    expectError(await get('/probe/admin', token), 403, 'FORBIDDEN');
    const me = await get('/me', token);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('PLAYER');
    expect(me.body.user.kind).toBe('REGISTERED');
  });
});

describe('RolesGuard: @Roles(ADMIN)', () => {
  it('PLAYER: 403 FORBIDDEN', async () => {
    const player = await seedRegisteredWithProfile('player_plain', 'Người chơi thường');
    expectError(await get('/probe/admin', await tokenFor(player.id)), 403, 'FORBIDDEN');
  });

  it('ADMIN: 200', async () => {
    const admin = await seedRegisteredWithProfile('admin_ok', 'Quản trị', 'ADMIN');
    const res = await get('/probe/admin', await tokenFor(admin.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('thiếu token: 401 UNAUTHENTICATED (không phải 403)', async () => {
    expectError(await get('/probe/admin'), 401, 'UNAUTHENTICATED');
  });
});

describe('GET /me', () => {
  it('khách: username null, không có passwordHash', async () => {
    const created = await call('POST', '/auth/guest', { body: { displayName: 'Khách Mới', avatarId: 'avatar_02' } });
    expect(created.status).toBe(200);
    const res = await get('/me', created.body.accessToken);
    expect(res.status).toBe(200);
    expect(() => MeResSchema.parse(res.body)).not.toThrow();
    expect(res.body.user.kind).toBe('GUEST');
    expect(res.body.user.username).toBeNull();
    expect(res.body.profile.displayName).toBe('Khách Mới');
    expect(res.body.profile.avatarId).toBe('avatar_02');
    expect(res.text).not.toContain('passwordHash');
  });

  it('tài khoản đã đăng ký: không lộ passwordHash', async () => {
    const user = await seedRegisteredWithProfile('reg_user', 'Đã Đăng Ký');
    const res = await get('/me', await tokenFor(user.id));
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('reg_user');
    expect(res.text).not.toContain('passwordHash');
    expect(res.text).not.toContain('test-hash');
  });
});

describe('PATCH /me/profile', () => {
  it('khách đổi được tên và nhân vật; displayNameKey cập nhật theo', async () => {
    const guest = await seedGuestWithProfile('Khách Cũ');
    const res = await patch('/me/profile', await tokenFor(guest.id), {
      displayName: 'Tên Mới Đẹp',
      avatarId: 'avatar_03',
    });
    expect(res.status).toBe(200);
    expect(() => PatchProfileResSchema.parse(res.body)).not.toThrow();
    expect(res.body.profile).toEqual({ userId: guest.id, displayName: 'Tên Mới Đẹp', avatarId: 'avatar_03' });
    expect(res.text).not.toContain('passwordHash');

    const row = await testPrisma.playerProfile.findUnique({ where: { userId: guest.id } });
    expect(row?.displayName).toBe('Tên Mới Đẹp');
    expect(row?.displayNameKey).toBe(displayNameKey('Tên Mới Đẹp'));
    expect(row?.avatarId).toBe('avatar_03');
  });

  it('đổi sang đúng tên hiện tại của mình: 200, không phải lỗi', async () => {
    const guest = await seedGuestWithProfile('Giữ Nguyên');
    const res = await patch('/me/profile', await tokenFor(guest.id), { displayName: 'Giữ Nguyên' });
    expect(res.status).toBe(200);
    expect(res.body.profile.displayName).toBe('Giữ Nguyên');
  });

  it('trùng tên với người khác: 409 DISPLAY_NAME_TAKEN, không đổi gì', async () => {
    await seedGuestWithProfile('Trà Đá');
    const guest = await seedGuestWithProfile('Khách Khác');
    const res = await patch('/me/profile', await tokenFor(guest.id), { displayName: 'Bánh Mì' });
    expect(res.status).toBe(200);
    const clash = await patch('/me/profile', await tokenFor(guest.id), { displayName: 'Trà Đá' });
    expectError(clash, 409, 'DISPLAY_NAME_TAKEN');
    const row = await testPrisma.playerProfile.findUnique({ where: { userId: guest.id } });
    expect(row?.displayName).toBe('Bánh Mì');
  });

  it('trùng khác dấu và khác hoa thường: DISPLAY_NAME_TAKEN', async () => {
    await seedGuestWithProfile('Trà Đá');
    const guest = await seedGuestWithProfile('Khách Thứ Ba');
    expectError(await patch('/me/profile', await tokenFor(guest.id), { displayName: 'TRA DA' }), 409, 'DISPLAY_NAME_TAKEN');
  });

  it('thiếu token: 401 UNAUTHENTICATED', async () => {
    expectError(await patch('/me/profile', undefined, { displayName: 'Ẩn Danh' }), 401, 'UNAUTHENTICATED');
  });
});
