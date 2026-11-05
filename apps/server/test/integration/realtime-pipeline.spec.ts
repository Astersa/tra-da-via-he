import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatSendReqSchema, EmptySchema, WorldJoinReqSchema, type Ack } from '@tdvh/shared';
import { SignJWT } from 'jose';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AppError } from '../../src/core/errors.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../../src/core/realtime-publisher.js';
import { ConnectionRegistry } from '../../src/realtime/connection-registry.js';
import { EventRouter, type SocketData } from '../../src/realtime/event-router.js';
import { resetDb, seedUser, testPrisma } from '../helpers/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
const OTHER_SECRET = 'another-secret-that-is-not-ours-0000000000000000';
const LOOPBACK = '127.0.0.1';

let app: INestApplication | undefined;
let url = '';
let registry: ConnectionRegistry;
const clients: ClientSocket[] = [];
// Counts handler runs. A rejected event must leave it unchanged.
let handlerCalls = 0;

// Real socket.io-client over a random port (listen(0)), real PostgreSQL. No mocks.
beforeEach(async () => {
  await resetDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://${LOOPBACK}:${port}`;
  registry = app.get(ConnectionRegistry);
  handlerCalls = 0;

  // Test-only probe handlers. They stand in for the real handlers of later tasks.
  const router = app.get(EventRouter);
  router.register('world:ping', { schema: EmptySchema, requireSession: false, fn: async () => ({}) });
  router.register('world:join', {
    schema: WorldJoinReqSchema,
    requireSession: false,
    fn: async (ctx, _req) => {
      handlerCalls++;
      const sessionId = randomUUID();
      (ctx.socket.data as SocketData).sessionId = sessionId;
      registry.bind(ctx.userId, ctx.socket.id, sessionId);
      return { sessionId };
    },
  });
  router.register('chat:send', {
    schema: ChatSendReqSchema,
    requireSession: true,
    fn: async (_ctx, req) => {
      handlerCalls++;
      if (req.text === 'FAIL_APP') throw new AppError('SERVER_FULL');
      if (req.text === 'FAIL_BOOM') throw new Error('secret-internal-detail');
      return { id: randomUUID() };
    },
  });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await app?.close();
  app = undefined;
});

function tokenFor(userId: string, secret = SECRET): Promise<string> {
  return signAccessToken(secret, userId);
}

async function connectWith(auth: Record<string, unknown>): Promise<ClientSocket> {
  const socket = connect(url, { transports: ['websocket'], reconnection: false, forceNew: true, auth });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
  return socket;
}

async function connectAs(userId: string): Promise<ClientSocket> {
  return connectWith({ token: await tokenFor(userId) });
}

// Ack round trip with a timeout so a missing ack fails the test instead of hanging.
async function call(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<unknown>> {
  return (await socket.timeout(5000).emitWithAck(event, payload)) as Ack<unknown>;
}

describe('socket handshake', () => {
  it('rejects a connection without a token', async () => {
    await expect(connectWith({})).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejects a malformed token', async () => {
    await expect(connectWith({ token: 'not-a-jwt' })).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejects a token signed with another secret', async () => {
    const user = await seedUser();
    await expect(connectWith({ token: await tokenFor(user.id, OTHER_SECRET) })).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const user = await seedUser();
    const past = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(past - 3600)
      .setExpirationTime(past - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(connectWith({ token })).rejects.toThrow('TOKEN_EXPIRED');
  });

  it('rejects a banned user, read from the DB', async () => {
    const user = await seedUser();
    await testPrisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });
    await expect(connectWith({ token: await tokenFor(user.id) })).rejects.toThrow('UNAUTHENTICATED');
  });

  it('accepts a valid token and stays in the lobby without a session', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    expect(socket.connected).toBe(true);
    const res = await call(socket, 'world:ping', {});
    expect(res).toEqual({ ok: true, data: {} });
  });
});

describe('event pipeline', () => {
  it('payload sai trả VALIDATION_FAILED và không gọi handler', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    const res = await call(socket, 'world:join', { serverId: 'not-a-uuid' });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(handlerCalls).toBe(0);
  });

  it('field lạ bị loại: payload có userId bị VALIDATION_FAILED, không gọi handler', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    const res = await call(socket, 'world:join', { serverId: randomUUID(), userId: randomUUID() });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(handlerCalls).toBe(0);
  });

  it('payload sai không làm sập socket', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    await call(socket, 'world:join', { serverId: 'not-a-uuid' });
    expect(socket.connected).toBe(true);
    expect(await call(socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
  });

  it('quá rate limit trả RATE_LIMITED kèm retryAfterMs', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    // world:ping capacity is 2 (EVENT_RATE_LIMITS).
    expect(await call(socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
    expect(await call(socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
    const res = await call(socket, 'world:ping', {});
    expect(res).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
    const retryAfterMs = (res as { error: { retryAfterMs?: number } }).error.retryAfterMs;
    expect(typeof retryAfterMs).toBe('number');
    expect(retryAfterMs).toBeGreaterThan(0);
  });

  it('rate limit được kiểm tra trước zod: payload sai khi đã hết quota trả RATE_LIMITED', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    await call(socket, 'world:ping', {});
    await call(socket, 'world:ping', {});
    const res = await call(socket, 'world:ping', { unexpected: true });
    expect(res).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('handler ném AppError: trả đúng mã lỗi', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    await call(socket, 'world:join', { serverId: randomUUID() });
    const res = await call(socket, 'chat:send', { text: 'FAIL_APP', clientMsgId: randomUUID() });
    expect(res).toMatchObject({ ok: false, error: { code: 'SERVER_FULL' } });
  });

  it('handler ném lỗi lạ: INTERNAL_ERROR, không lộ message hay stack', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    await call(socket, 'world:join', { serverId: randomUUID() });
    const res = await call(socket, 'chat:send', { text: 'FAIL_BOOM', clientMsgId: randomUUID() });
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('secret-internal-detail');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('    at ');
  });

  it('sessionId cũ sau khi tab mới join trả SESSION_STALE, không gọi handler', async () => {
    const user = await seedUser();
    const first = await connectAs(user.id);
    await call(first, 'world:join', { serverId: randomUUID() });
    const second = await connectAs(user.id);
    await call(second, 'world:join', { serverId: randomUUID() });
    const before = handlerCalls;
    const res = await call(first, 'chat:send', { text: 'hello', clientMsgId: randomUUID() });
    expect(res).toMatchObject({ ok: false, error: { code: 'SESSION_STALE' } });
    expect(handlerCalls).toBe(before);
  });

  it('event cần session mà chưa join trả SESSION_STALE', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    const res = await call(socket, 'chat:send', { text: 'hello', clientMsgId: randomUUID() });
    expect(res).toMatchObject({ ok: false, error: { code: 'SESSION_STALE' } });
    expect(handlerCalls).toBe(0);
  });

  it('nhiều event song song: đúng 2 được xử lý, 3 bị RATE_LIMITED', async () => {
    const user = await seedUser();
    const socket = await connectAs(user.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => call(socket, 'world:ping', {})));
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(results.filter((r) => !r.ok && r.error.code === 'RATE_LIMITED').length).toBe(3);
  });

  it('RealtimePublisher.disconnectUser ngắt mọi socket của user', async () => {
    const user = await seedUser();
    const a = await connectAs(user.id);
    const b = await connectAs(user.id);
    const closed = Promise.all([
      new Promise<void>((resolve) => a.once('disconnect', () => resolve())),
      new Promise<void>((resolve) => b.once('disconnect', () => resolve())),
    ]);
    app?.get<RealtimePublisher>(REALTIME_PUBLISHER).disconnectUser(user.id, 'LOGOUT');
    await closed;
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(false);
  });
});
