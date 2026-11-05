import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ServerEventSchemas,
  WorldStateSchema,
  displayNameKey,
  getSpawn,
  isWalkable,
  street01Map,
  type Ack,
  type WorldState,
} from '@tdvh/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { resetDb, seedDefaultShop, seedPlot, seedServer, testPrisma } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md M1-E3-T4. Real socket.io-client, real PostgreSQL, no mocks.
// No fixed sleeps: every wait is a waitFor with a timeout. A "B did not receive X" check
// first makes B round-trip a world:ping, so anything the server sent before it has arrived.

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';
const ACK_MS = 5000;
const CASE_MS = 20000;
const SERVER_EVENTS = [...Object.keys(ServerEventSchemas), 'disconnect'];

let app: INestApplication | undefined;
let url = '';
let counter = 0;
const clients: ClientSocket[] = [];

// Records every event a client receives, and lets a test wait for one with a timeout.
class Inbox {
  readonly got: { event: string; payload: unknown }[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(socket: ClientSocket) {
    for (const event of SERVER_EVENTS) {
      socket.on(event, (payload: unknown) => {
        this.got.push({ event, payload });
        for (const w of this.waiters) w();
      });
    }
  }

  all(event: string, pred: (p: any) => boolean = () => true): any[] {
    return this.got.filter((g) => g.event === event && pred(g.payload)).map((g) => g.payload);
  }

  indexOf(event: string, pred: (p: any) => boolean = () => true): number {
    return this.got.findIndex((g) => g.event === event && pred(g.payload));
  }

  waitFor(event: string, pred: (p: any) => boolean = () => true, timeoutMs = ACK_MS): Promise<any> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = (): void => {
        const hit = this.got.find((g) => g.event === event && pred(g.payload));
        if (!hit) return;
        this.waiters.delete(check);
        if (timer) clearTimeout(timer);
        resolve(hit.payload);
      };
      timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`timeout after ${timeoutMs}ms waiting for ${event}`));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }
}

interface Client {
  userId: string;
  socket: ClientSocket;
  inbox: Inbox;
}

beforeEach(async () => {
  await resetDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://${LOOPBACK}:${port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await app?.close();
  app = undefined;
});

// ---- helpers ----

// Player with profile and wallet, as users.service creates them. Not a mock.
async function seedPlayer(opts: { name?: string; guest?: boolean; balance?: bigint; username?: string } = {}) {
  const n = ++counter;
  const displayName = opts.name ?? `Player${n}`;
  const guest = opts.guest ?? false;
  return testPrisma.user.create({
    data: {
      kind: guest ? 'GUEST' : 'REGISTERED',
      ...(guest ? {} : { username: opts.username ?? `secret${n}name`, passwordHash: 'test-hash' }),
      wallet: { create: { balance: opts.balance ?? 0n } },
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

// Ack round trip with a timeout, so a missing ack fails the test instead of hanging.
async function call(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<unknown>> {
  return (await socket.timeout(ACK_MS).emitWithAck(event, payload)) as Ack<unknown>;
}

async function joinOk(c: Client, serverId: string): Promise<WorldState> {
  const res = await call(c.socket, 'world:join', { serverId });
  expect(res).toMatchObject({ ok: true });
  return (res as { data: WorldState }).data;
}

// Round trip on B's own socket: once it returns, everything the server sent to B before has arrived.
async function syncPoint(c: Client): Promise<void> {
  expect(await call(c.socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
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

// ---- WorldState ----

describe('world:join WorldState', () => {
  it(
    'A nhận WorldState đúng schema: self, ví của chính mình, shop và plot đọc từ DB, không có username',
    async () => {
      const server = await activeServer();
      const plot = await seedPlot(server.id, 'D1');
      await seedDefaultShop(server.id, plot.id, 1);
      const a = await seedPlayer({ name: 'Alpha', balance: 100n, username: 'secretalphaname' });
      await seedPlayer({ name: 'Other', balance: 987654n });

      const c = await connectAs(a.id);
      const state = await joinOk(c, server.id);

      expect(() => WorldStateSchema.parse(state)).not.toThrow();
      expect(state.serverId).toBe(server.id);
      expect(state.self).toMatchObject({ userId: a.id, displayName: 'Alpha', seatId: null, connected: true });
      expect(state.players).toEqual([]);
      expect(state.wallet).toEqual({ balance: '100', held: '0', available: '100', version: 0 });
      expect(state.plots).toEqual([
        expect.objectContaining({ id: plot.id, mapSlot: 'D1', openFee: '1000', shopId: expect.any(String) }),
      ]);
      expect(state.shops).toEqual([
        expect.objectContaining({ mapSlot: 'D1', acceptingOrders: false, onlineStaff: 0 }),
      ]);
      expect(state.myOpenOrders).toEqual([]);
      expect(state.staff).toBeNull();
      expect(state.recentChat).toEqual([]);
      expect(state.takenSeats).toEqual([]);

      const raw = JSON.stringify(state);
      expect(raw).not.toContain('"username"');
      expect(raw).not.toContain('secretalphaname');
      expect(raw).not.toContain('987654');
    },
    CASE_MS,
  );

  it(
    'A vào sau thì thấy B trong WorldState.players, và B nhận player:joined của A',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);

      const ca = await connectAs(a.id);
      const stateA = await joinOk(ca, server.id);
      expect(stateA.players.map((p) => p.userId)).toEqual([b.id]);

      const joined = await cb.inbox.waitFor('player:joined', (p) => p.userId === a.id);
      expect(joined).toMatchObject({ userId: a.id, connected: true });
      expect(cb.inbox.all('player:joined', (p) => p.userId === a.id)).toHaveLength(1);
    },
    CASE_MS,
  );

  it(
    'A đã ở trong world thì nhận player:joined của B khi B vào',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);

      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);

      const joined = await ca.inbox.waitFor('player:joined', (p) => p.userId === b.id);
      expect(joined).toMatchObject({ userId: b.id, connected: true });
    },
    CASE_MS,
  );
});

// ---- movement and chat ----

describe('player:move và chat trong world', () => {
  it(
    'A và B thấy nhau di chuyển qua player:moved',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const p = walkableNearSpawn();
      ca.socket.emit('player:move', { x: p.x, y: p.y, dir: 'right', seq: 1 });
      const atB = await cb.inbox.waitFor('player:moved', movedBy(a.id, 1));
      expect(atB.moves).toContainEqual(expect.objectContaining({ userId: a.id, x: p.x, y: p.y, dir: 'right', seq: 1 }));

      cb.socket.emit('player:move', { x: p.x, y: p.y, dir: 'left', seq: 1 });
      const atA = await ca.inbox.waitFor('player:moved', movedBy(b.id, 1));
      expect(atA.moves).toContainEqual(expect.objectContaining({ userId: b.id, dir: 'left', seq: 1 }));
    },
    CASE_MS,
  );

  it(
    'khách vào world, di chuyển và chat được',
    async () => {
      const server = await activeServer();
      const guest = await seedPlayer({ guest: true });
      const b = await seedPlayer();
      const cg = await connectAs(guest.id);
      const cb = await connectAs(b.id);
      const sg = await joinOk(cg, server.id);
      expect(sg.self.userId).toBe(guest.id);
      await joinOk(cb, server.id);

      const p = walkableNearSpawn();
      cg.socket.emit('player:move', { x: p.x, y: p.y, dir: 'up', seq: 1 });
      await cb.inbox.waitFor('player:moved', movedBy(guest.id, 1));

      expect(await call(cg.socket, 'chat:send', { text: 'chao', clientMsgId: randomUUID() })).toMatchObject({
        ok: true,
      });
      await cb.inbox.waitFor('chat:message', (m) => m.text === 'chao' && m.userId === guest.id);
    },
    CASE_MS,
  );

  it(
    'chat ở server A không tới server B',
    async () => {
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const c = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      const cc = await connectAs(c.id);
      await joinOk(ca, x.id);
      await joinOk(cb, x.id);
      await joinOk(cc, y.id);

      expect(await call(ca.socket, 'chat:send', { text: 'hello-x', clientMsgId: randomUUID() })).toMatchObject({
        ok: true,
      });
      await cb.inbox.waitFor('chat:message', (m) => m.text === 'hello-x');
      await syncPoint(cc);
      expect(cc.inbox.all('chat:message')).toEqual([]);
    },
    CASE_MS,
  );
});

// ---- tabs and sockets ----

describe('nhiều socket và nhiều tab', () => {
  it(
    'mở socket thứ 2 không join thì socket 1 vẫn chạy',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const c1 = await connectAs(a.id);
      await joinOk(c1, server.id);
      const c2 = await connectAs(a.id);

      expect(await call(c2.socket, 'world:resync', {})).toMatchObject({
        ok: false,
        error: { code: 'SESSION_STALE' },
      });
      expect(await call(c2.socket, 'world:leave', {})).toMatchObject({
        ok: false,
        error: { code: 'SESSION_STALE' },
      });

      expect(await call(c1.socket, 'world:resync', {})).toMatchObject({ ok: true, data: { serverId: server.id } });
      const p = walkableNearSpawn();
      c1.socket.emit('player:move', { x: p.x, y: p.y, dir: 'down', seq: 1 });
      await c1.inbox.waitFor('player:moved', movedBy(a.id, 1));
      expect(c1.socket.connected).toBe(true);
      expect(c2.socket.connected).toBe(true);
    },
    CASE_MS,
  );

  it(
    'socket 2 join cùng server: socket 1 nhận session:replaced NEW_TAB rồi bị ngắt, B không nhận player:left',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);

      const a1 = await connectAs(a.id);
      const s1 = await joinOk(a1, server.id);
      const a2 = await connectAs(a.id);
      const s2 = await joinOk(a2, server.id);
      expect(s2.sessionId).toBe(s1.sessionId);

      const replaced = await a1.inbox.waitFor('session:replaced');
      expect(replaced).toEqual({ reason: 'NEW_TAB' });
      await a1.inbox.waitFor('disconnect');
      expect(a1.inbox.indexOf('session:replaced')).toBeLessThan(a1.inbox.indexOf('disconnect'));
      expect(a1.socket.connected).toBe(false);

      await syncPoint(cb);
      expect(cb.inbox.all('player:left')).toEqual([]);
      expect(cb.inbox.all('player:joined', (p) => p.userId === a.id)).toHaveLength(1);
    },
    CASE_MS,
  );

  it(
    'world:join lặp trên cùng socket là an toàn: cùng session, không phát player:joined hay player:left lần hai',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);

      const ca = await connectAs(a.id);
      const first = await joinOk(ca, server.id);
      const second = await joinOk(ca, server.id);
      expect(second.sessionId).toBe(first.sessionId);
      expect(ca.socket.connected).toBe(true);

      await syncPoint(cb);
      expect(cb.inbox.all('player:joined', (p) => p.userId === a.id)).toHaveLength(1);
      expect(cb.inbox.all('player:left')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'world:leave: người ở lại nhận player:left LEFT, socket đã rời không còn tác dụng',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);

      expect(await call(ca.socket, 'world:leave', {})).toEqual({ ok: true, data: {} });
      expect(await cb.inbox.waitFor('player:left', (e) => e.userId === a.id)).toEqual({
        userId: a.id,
        reason: 'LEFT',
      });

      expect(await call(ca.socket, 'world:resync', {})).toMatchObject({
        ok: false,
        error: { code: 'SESSION_STALE' },
      });
      ca.socket.emit('player:move', { ...walkableNearSpawn(), dir: 'up', seq: 1 });
      await syncPoint(cb);
      expect(cb.inbox.all('player:moved', movedBy(a.id, 1))).toEqual([]);
    },
    CASE_MS,
  );
});

// ---- server switch ----

describe('server:switch', () => {
  it(
    'A rời room cũ: người ở server cũ nhận player:left, người ở server mới nhận player:joined, socket cũ không có tác dụng',
    async () => {
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer();
      const b1 = await seedPlayer();
      const b2 = await seedPlayer();
      const cb1 = await connectAs(b1.id);
      await joinOk(cb1, x.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, x.id);
      const cb2 = await connectAs(b2.id);
      await joinOk(cb2, y.id);

      const switched = await call(ca.socket, 'server:switch', { targetServerId: y.id });
      expect(switched).toMatchObject({ ok: true, data: { serverId: y.id } });

      expect(await cb1.inbox.waitFor('player:left', (e) => e.userId === a.id)).toEqual({
        userId: a.id,
        reason: 'SWITCHED',
      });
      const joined = await cb2.inbox.waitFor('player:joined', (p) => p.userId === a.id);
      expect(joined).toMatchObject({ userId: a.id });

      // A socket that never joined is not bound to any session. Its move must have no effect.
      // Its own resync ack is the sync point: the server handled the move before it.
      const lobby = await connectAs(a.id);
      lobby.socket.emit('player:move', { ...walkableNearSpawn(), dir: 'up', seq: 99 });
      expect(await call(lobby.socket, 'world:resync', {})).toMatchObject({
        ok: false,
        error: { code: 'SESSION_STALE' },
      });

      // The switched socket moves on Y. Only Y hears it.
      const p = walkableNearSpawn();
      ca.socket.emit('player:move', { x: p.x, y: p.y, dir: 'left', seq: 1 });
      await cb2.inbox.waitFor('player:moved', movedBy(a.id, 1));
      await syncPoint(cb2);
      expect(cb2.inbox.all('player:moved', movedBy(a.id, 99))).toEqual([]);

      await syncPoint(cb1);
      expect(cb1.inbox.all('player:moved', movedBy(a.id, 1))).toEqual([]);
      expect(cb1.inbox.all('player:moved', movedBy(a.id, 99))).toEqual([]);
      expect(ca.inbox.all('player:left', (e) => e.userId === a.id)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'server:switch về cùng server đang ở trả ALREADY_IN_SERVER và không đổi gì',
    async () => {
      const x = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, x.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, x.id);

      expect(await call(ca.socket, 'server:switch', { targetServerId: x.id })).toMatchObject({
        ok: false,
        error: { code: 'ALREADY_IN_SERVER' },
      });
      await syncPoint(cb);
      expect(cb.inbox.all('player:left')).toEqual([]);
    },
    CASE_MS,
  );
});
