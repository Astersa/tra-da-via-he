import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { displayNameKey, getSpawn, isWalkable, street01Map, type Ack } from '@tdvh/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { SessionEndHooks, type SessionEndedEvent } from '../../src/session/session-end.hooks.js';
import { PresenceStore } from '../../src/world/presence.store.js';
import { resetDb, seedServer, testPrisma } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md M1-E3-T5. Real socket.io-client, real PostgreSQL, no mocks.
// The grace period is 1 s through GAME_RECONNECT_GRACE_SECONDS; no test sleeps for the real 30 s.
// Every wait is a waitUntil or an Inbox.waitFor with a timeout. "B did not receive X" checks first
// make B round-trip a world:ping, so anything the server sent to B before has arrived.

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';
const ACK_MS = 5000;
const CASE_MS = 20000;
const GRACE_MS = 1000;
const SERVER_EVENTS = ['player:joined', 'player:left', 'player:moved', 'player:interacted', 'session:replaced', 'disconnect'];

let app: INestApplication | undefined;
let url = '';
let counter = 0;
const clients: ClientSocket[] = [];

class Inbox {
  readonly got: { event: string; payload: any }[] = [];

  constructor(socket: ClientSocket) {
    for (const event of SERVER_EVENTS) {
      socket.on(event, (payload: unknown) => {
        this.got.push({ event, payload });
      });
    }
  }

  all(event: string, pred: (p: any) => boolean = () => true): any[] {
    return this.got.filter((g) => g.event === event && pred(g.payload)).map((g) => g.payload);
  }

  async waitFor(event: string, pred: (p: any) => boolean = () => true, timeoutMs = ACK_MS): Promise<any> {
    await waitUntil(() => this.got.some((g) => g.event === event && pred(g.payload)), `${event}`, timeoutMs);
    return this.got.find((g) => g.event === event && pred(g.payload))?.payload;
  }
}

interface Client {
  userId: string;
  socket: ClientSocket;
  inbox: Inbox;
}

beforeEach(async () => {
  process.env.GAME_RECONNECT_GRACE_SECONDS = '1';
  await resetDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://${LOOPBACK}:${port}`;
});

afterEach(async () => {
  delete process.env.GAME_RECONNECT_GRACE_SECONDS;
  for (const c of clients.splice(0)) c.disconnect();
  await app?.close();
  app = undefined;
});

// ---- helpers ----

// Polls pred until it holds. Fails with the name of what was awaited when the timeout is reached.
async function waitUntil(pred: () => boolean | Promise<boolean>, what: string, timeoutMs = ACK_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > deadline) throw new Error(`timeout after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Lets real time pass (used only to check that a timer did NOT fire). Always called with GRACE_MS plus margin.
function elapse(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedPlayer(): Promise<{ id: string }> {
  const n = ++counter;
  const displayName = `Player${n}`;
  return testPrisma.user.create({
    data: {
      kind: 'REGISTERED',
      username: `secret${n}name`,
      passwordHash: 'test-hash',
      wallet: { create: { balance: 0n } },
      profile: {
        create: { displayName, displayNameKey: displayNameKey(displayName), avatarId: 'avatar_01' },
      },
    },
  });
}

async function activeServer() {
  const s = await seedServer();
  return testPrisma.gameServer.update({ where: { id: s.id }, data: { status: 'ACTIVE' } });
}

async function connectAs(userId: string): Promise<Client> {
  const socket = connect(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { token: await signAccessToken(SECRET, userId) },
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
  return { userId, socket, inbox: new Inbox(socket) };
}

async function call(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<unknown>> {
  return (await socket.timeout(ACK_MS).emitWithAck(event, payload)) as Ack<unknown>;
}

async function joinOk(c: Client, serverId: string): Promise<void> {
  const res = await call(c.socket, 'world:join', { serverId });
  expect(res).toMatchObject({ ok: true });
}

async function syncPoint(c: Client): Promise<void> {
  expect(await call(c.socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
}

async function activeSessionId(userId: string): Promise<string | undefined> {
  return (await testPrisma.serverSession.findFirst({ where: { userId, status: 'ACTIVE' } }))?.id;
}

// The ReconnectService is read lazily so that a missing module fails only the tests that need it.
async function reconnectService(): Promise<{ pendingCount(): number }> {
  const { ReconnectService } = await import('../../src/session/reconnect.service.js');
  return app!.get(ReconnectService);
}

// Every session end seen by the hooks, registered after the app's own hooks.
function recordEnds(): SessionEndedEvent[] {
  const ended: SessionEndedEvent[] = [];
  app!.get(SessionEndHooks).register(async (e) => {
    ended.push(e);
  });
  return ended;
}

// A tile within 8 px of spawn that the map allows. Moves are checked against speed, so this is always valid.
function walkableNearSpawn(): { x: number; y: number } {
  const s = getSpawn(street01Map);
  for (let r = 0; r <= 8; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]] as const) {
      if (isWalkable(street01Map, s.x + dx, s.y + dy)) return { x: s.x + dx, y: s.y + dy };
    }
  }
  throw new Error('no walkable tile near spawn');
}

const movedBy = (userId: string, seq: number) => (e: { moves: { userId: string; seq: number }[] }) =>
  e.moves.some((m) => m.userId === userId && m.seq === seq);

// ---- grace period ----

describe('reconnect trong grace (M1-E3-T5)', () => {
  it(
    'ngắt rồi nối lại trong grace: cùng sessionId, giữ presence, hủy timer, B không nhận player:left',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = await activeSessionId(a.id);
      expect(sid).toBeDefined();

      ca.socket.disconnect();
      await waitUntil(async () => (await reconnectService()).pendingCount() === 1, 'grace timer');
      await cb.inbox.waitFor('player:interacted', (p) => p.userId === a.id && p.state === 'DISCONNECTED');

      const ca2 = await connectAs(a.id);
      expect(await call(ca2.socket, 'world:join', { serverId: server.id, resumeSessionId: sid })).toMatchObject({
        ok: true,
      });
      expect(await activeSessionId(a.id)).toBe(sid);
      expect((await reconnectService()).pendingCount()).toBe(0);
      expect(app!.get(PresenceStore).get(a.id)?.sessionId).toBe(sid);

      await cb.inbox.waitFor('player:interacted', (p) => p.userId === a.id && p.state === 'RECONNECTED');
      await syncPoint(cb);
      expect(cb.inbox.all('player:left')).toEqual([]);
      expect(cb.inbox.all('player:joined', (p) => p.userId === a.id)).toHaveLength(1);
    },
    CASE_MS,
  );

  it(
    'hết grace: session ENDED GRACE_EXPIRED, B nhận player:left đúng một lần, hook chạy đúng một lần',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = (await activeSessionId(a.id)) as string;
      const ended = recordEnds();

      ca.socket.disconnect();
      await cb.inbox.waitFor('player:left', (p) => p.userId === a.id);
      await waitUntil(() => ended.length === 1, 'session end hook');
      await syncPoint(cb);

      expect(cb.inbox.all('player:left', (p) => p.userId === a.id)).toEqual([
        { userId: a.id, reason: 'GRACE_EXPIRED' },
      ]);
      expect(await testPrisma.serverSession.findUnique({ where: { id: sid } })).toMatchObject({
        status: 'ENDED',
        endReason: 'GRACE_EXPIRED',
      });
      expect(ended.filter((e) => e.sessionId === sid)).toEqual([
        expect.objectContaining({ userId: a.id, serverId: server.id, reason: 'GRACE_EXPIRED' }),
      ]);
      expect(app!.get(PresenceStore).get(a.id)).toBeUndefined();
    },
    CASE_MS,
  );

  it(
    'resumeSessionId của người khác bị bỏ qua: B được session mới, session của A vẫn ACTIVE',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sidA = (await activeSessionId(a.id)) as string;

      const cb = await connectAs(b.id);
      expect(await call(cb.socket, 'world:join', { serverId: server.id, resumeSessionId: sidA })).toMatchObject({
        ok: true,
      });
      const sidB = await activeSessionId(b.id);
      expect(sidB).toBeDefined();
      expect(sidB).not.toBe(sidA);
      expect(await activeSessionId(a.id)).toBe(sidA);
    },
    CASE_MS,
  );

  it(
    'thay tab: socket cũ đóng không kích hoạt grace, không player:left, session mới vẫn sống sau khi hết grace',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca1 = await connectAs(a.id);
      await joinOk(ca1, server.id);
      const sid1 = await activeSessionId(a.id);

      const ca2 = await connectAs(a.id);
      await joinOk(ca2, server.id);
      await ca1.inbox.waitFor('session:replaced');
      await ca1.inbox.waitFor('disconnect');
      await syncPoint(ca2);

      expect((await reconnectService()).pendingCount()).toBe(0);
      const sid2 = await activeSessionId(a.id);
      expect(sid2).toBeDefined();
      expect(sid2).toBe(sid1);

      await elapse(GRACE_MS + 300);
      await syncPoint(cb);
      expect(cb.inbox.all('player:left', (p) => p.userId === a.id)).toEqual([]);
      expect(await activeSessionId(a.id)).toBe(sid2);
      expect(await call(ca2.socket, 'world:resync', {})).toMatchObject({ ok: true });
    },
    CASE_MS,
  );
  it(
    'ngắt, socket khác của cùng user join lại, rồi hết thời gian grace: timer không kết thúc session',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca1 = await connectAs(a.id);
      await joinOk(ca1, server.id);
      const sid = (await activeSessionId(a.id)) as string;

      ca1.socket.disconnect();
      await waitUntil(async () => (await reconnectService()).pendingCount() === 1, 'grace timer');

      const ca2 = await connectAs(a.id);
      await joinOk(ca2, server.id);
      expect((await reconnectService()).pendingCount()).toBe(0);

      await elapse(GRACE_MS + 300);
      await syncPoint(cb);
      expect(await activeSessionId(a.id)).toBe(sid);
      expect(cb.inbox.all('player:left', (p) => p.userId === a.id)).toEqual([]);
      expect(await call(ca2.socket, 'world:resync', {})).toMatchObject({ ok: true });
    },
    CASE_MS,
  );
});

describe('grace timer dọn khi module hủy (M1-E3-T5)', () => {
  it(
    'app.close() khi đang có grace: timer bị hủy, session không kết thúc, hook không chạy',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = (await activeSessionId(a.id)) as string;
      const ended = recordEnds();
      const svc = await reconnectService();

      ca.socket.disconnect();
      await waitUntil(() => svc.pendingCount() === 1, 'grace timer');

      await app!.close();
      app = undefined;
      expect(svc.pendingCount()).toBe(0);

      await elapse(GRACE_MS + 300);
      expect(await activeSessionId(a.id)).toBe(sid);
      expect(ended).toEqual([]);
    },
    CASE_MS,
  );
});

// ---- lastX, lastY written when the session ends (M1-E4-T3 contract, done here) ----

describe('vị trí khi session kết thúc (M1-E3-T5)', () => {
  it(
    'kết thúc do world:leave ghi lastX, lastY từ presence',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = (await activeSessionId(a.id)) as string;

      const p = walkableNearSpawn();
      ca.socket.emit('player:move', { x: p.x, y: p.y, dir: 'right', seq: 1 });
      await cb.inbox.waitFor('player:moved', movedBy(a.id, 1));

      expect(await call(ca.socket, 'world:leave', {})).toMatchObject({ ok: true });
      expect(await testPrisma.serverSession.findUnique({ where: { id: sid } })).toMatchObject({
        status: 'ENDED',
        endReason: 'LEFT',
        lastX: p.x,
        lastY: p.y,
      });
    },
    CASE_MS,
  );

  it(
    'kết thúc do server:switch ghi lastX, lastY của session cũ',
    async () => {
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, x.id);
      const sid = (await activeSessionId(a.id)) as string;

      const p = walkableNearSpawn();
      ca.socket.emit('player:move', { x: p.x, y: p.y, dir: 'right', seq: 1 });
      await waitUntil(() => app!.get(PresenceStore).get(a.id)?.seq === 1, 'move applied');

      expect(await call(ca.socket, 'server:switch', { targetServerId: y.id })).toMatchObject({ ok: true });
      expect(await testPrisma.serverSession.findUnique({ where: { id: sid } })).toMatchObject({
        status: 'ENDED',
        endReason: 'SWITCHED',
        lastX: p.x,
        lastY: p.y,
      });
    },
    CASE_MS,
  );

  it(
    'hết grace ghi lastX, lastY của session',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = (await activeSessionId(a.id)) as string;

      const p = walkableNearSpawn();
      ca.socket.emit('player:move', { x: p.x, y: p.y, dir: 'right', seq: 1 });
      await waitUntil(() => app!.get(PresenceStore).get(a.id)?.seq === 1, 'move applied');

      ca.socket.disconnect();
      // The hook writes lastX after the commit, so wait for the position itself, not only for ENDED.
      await waitUntil(async () => {
        const row = await testPrisma.serverSession.findUnique({ where: { id: sid } });
        return row?.status === 'ENDED' && row.lastX !== null;
      }, 'grace expiry with position saved');
      expect(await testPrisma.serverSession.findUnique({ where: { id: sid } })).toMatchObject({
        endReason: 'GRACE_EXPIRED',
        lastX: p.x,
        lastY: p.y,
      });
    },
    CASE_MS,
  );
});

// ---- boot ----

describe('BootTasks và endAllOnBoot (M1-E3-T5)', () => {
  it(
    'BootTasks.run làm session ACTIVE thành ENDED với SERVER_RESTART, không chạy SessionEndHooks, không ghi lastX',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const sid = (await activeSessionId(a.id)) as string;
      const ended = recordEnds();

      const { BootTasks } = await import('../../src/core/boot-tasks.js');
      await app!.get(BootTasks).run(new Date());

      const row = await testPrisma.serverSession.findUnique({ where: { id: sid } });
      expect(row).toMatchObject({ status: 'ENDED', endReason: 'SERVER_RESTART', lastX: null, lastY: null });
      expect(row?.endedAt).not.toBeNull();
      expect(ended).toEqual([]);
    },
    CASE_MS,
  );

  it('BootTasks chạy tuần tự theo order; task lỗi làm run ném lỗi và các task sau không chạy', async () => {
    const { BootTasks } = await import('../../src/core/boot-tasks.js');
    const boot = new BootTasks();
    const calls: string[] = [];
    boot.register(30, 'c', async () => {
      calls.push('c');
    });
    boot.register(10, 'a', async () => {
      calls.push('a');
    });
    boot.register(20, 'b', async () => {
      calls.push('b');
      throw new Error('boom');
    });
    await expect(boot.run(new Date())).rejects.toThrow('boom');
    expect(calls).toEqual(['a', 'b']);
  });
});
