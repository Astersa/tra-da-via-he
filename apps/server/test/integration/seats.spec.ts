import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  displayNameKey,
  getSeats,
  street01Map,
  WorldStateSchema,
  type Ack,
  type WorldState,
} from '@tdvh/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { PresenceStore } from '../../src/world/presence.store.js';
import { resetDb, seedServer, testPrisma } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md M1-E4-T4. Real socket.io-client, real PostgreSQL, no mocks.
// Seats are in-memory state of the server process. Tests put a player next to a seat by writing the
// in-memory presence position (the same entry the server reads), because walking there takes many moves
// and the move rate limit would make the test slow. No fixed sleeps: every wait is waitUntil with a timeout.

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';
const ACK_MS = 5000;
const CASE_MS = 20000;
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
    await waitUntil(() => this.got.some((g) => g.event === event && pred(g.payload)), event, timeoutMs);
    return this.got.find((g) => g.event === event && pred(g.payload))?.payload;
  }
}

interface Client {
  userId: string;
  socket: ClientSocket;
  inbox: Inbox;
}

// Polls pred until it holds. Fails with the name of what was awaited when the timeout is reached.
async function waitUntil(pred: () => boolean, what: string, timeoutMs = ACK_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Starts a fresh app with the given reconnect grace (seconds). The grace is read when the app is compiled.
async function boot(graceSeconds = '1'): Promise<void> {
  process.env.GAME_RECONNECT_GRACE_SECONDS = graceSeconds;
  await resetDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, LOOPBACK);
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://${LOOPBACK}:${port}`;
}

afterEach(async () => {
  delete process.env.GAME_RECONNECT_GRACE_SECONDS;
  for (const c of clients.splice(0)) c.disconnect();
  await app?.close();
  app = undefined;
});

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

// Fresh WorldState of a client (world:resync). Used to read takenSeats and self.seatId from the server.
async function resync(c: Client): Promise<WorldState> {
  const res = await call(c.socket, 'world:resync', {});
  expect(res).toMatchObject({ ok: true });
  const state = (res as { data: WorldState }).data;
  expect(() => WorldStateSchema.parse(state)).not.toThrow();
  return state;
}

// Puts the player at (x, y) in the in-memory presence store. Test setup only: see the header comment.
function place(userId: string, x: number, y: number): void {
  const entry = app!.get(PresenceStore).get(userId);
  if (!entry) throw new Error(`no presence entry for ${userId}`);
  entry.x = x;
  entry.y = y;
}

function seat(id: string): { id: string; x: number; y: number } {
  const s = getSeats(street01Map).find((x) => x.id === id);
  if (!s) throw new Error(`map has no seat ${id}`);
  return s;
}

const SEAT_ID = 'D1-S1';

describe('player:sit, player:stand, player:interact', () => {
  it(
    'hai người cùng ngồi một ghế song song: đúng 1 OK, 1 SEAT_TAKEN',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      place(b.id, s.x, s.y);

      const [ra, rb] = await Promise.all([
        call(ca.socket, 'player:sit', { seatId: s.id }),
        call(cb.socket, 'player:sit', { seatId: s.id }),
      ]);
      const results = [ra, rb];
      expect(results.filter((r) => r.ok)).toEqual([{ ok: true, data: { seatId: s.id } }]);
      expect(results.filter((r) => !r.ok).map((r) => (r as { error: { code: string } }).error.code)).toEqual([
        'SEAT_TAKEN',
      ]);

      const seated = [a, b].filter((u) => {
        const entry = app!.get(PresenceStore).get(u.id);
        return entry?.seatId === s.id;
      });
      expect(seated).toHaveLength(1);
    },
    CASE_MS,
  );

  it(
    'ngồi thành công: vị trí chuyển tới tâm ghế, takenSeats và self.seatId đúng, người khác thấy player:interacted SIT',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);

      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toEqual({ ok: true, data: { seatId: s.id } });
      expect(await cb.inbox.waitFor('player:interacted', (p) => p.state === 'SIT')).toEqual({
        userId: a.id,
        state: 'SIT',
        seatId: s.id,
      });

      const selfState = await resync(ca);
      expect(selfState.self).toMatchObject({ userId: a.id, seatId: s.id, x: s.x, y: s.y });
      expect(selfState.takenSeats).toEqual([{ seatId: s.id, userId: a.id }]);

      const otherState = await resync(cb);
      expect(otherState.takenSeats).toEqual([{ seatId: s.id, userId: a.id }]);
      expect(otherState.players).toContainEqual(expect.objectContaining({ userId: a.id, seatId: s.id, x: s.x, y: s.y }));
    },
    CASE_MS,
  );

  it(
    'id ghế sai trả SEAT_NOT_FOUND, và không đổi trạng thái',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);

      expect(await call(ca.socket, 'player:sit', { seatId: 'D9-S1' })).toMatchObject({
        ok: false,
        error: { code: 'SEAT_NOT_FOUND' },
      });
      expect(app!.get(PresenceStore).get(a.id)?.seatId).toBeNull();
    },
    CASE_MS,
  );

  it(
    'quá 48 px từ vị trí phía server trả TOO_FAR; đúng 48 px thì ngồi được',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      const s = seat(SEAT_ID);

      // Spawn is far from every seat.
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({
        ok: false,
        error: { code: 'TOO_FAR' },
      });
      expect(app!.get(PresenceStore).get(a.id)?.seatId).toBeNull();

      place(a.id, s.x + 49, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({
        ok: false,
        error: { code: 'TOO_FAR' },
      });

      place(a.id, s.x + 48, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toEqual({ ok: true, data: { seatId: s.id } });
    },
    CASE_MS,
  );

  it(
    'đang ngồi rồi ngồi ghế khác: trả ghế cũ, ghế mới giữ; ghế mới cách xa quá 48 px so với ghế cũ thì TOO_FAR và giữ ghế cũ',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s1 = seat('D1-S1');
      const s2 = seat('D1-S2');
      const far = seat('D2-S1');
      place(a.id, s1.x, s1.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s1.id })).toMatchObject({ ok: true });

      expect(await call(ca.socket, 'player:sit', { seatId: far.id })).toMatchObject({
        ok: false,
        error: { code: 'TOO_FAR' },
      });
      expect(app!.get(PresenceStore).get(a.id)?.seatId).toBe(s1.id);

      expect(await call(ca.socket, 'player:sit', { seatId: s2.id })).toEqual({ ok: true, data: { seatId: s2.id } });
      const otherState = await resync(cb);
      expect(otherState.takenSeats).toEqual([{ seatId: s2.id, userId: a.id }]);
    },
    CASE_MS,
  );

  it(
    'đứng: ghế được trả, người khác thấy player:interacted STAND; đứng khi không ngồi thì ack OK và không phát gì',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });

      expect(await call(ca.socket, 'player:stand', {})).toEqual({ ok: true, data: {} });
      expect(await cb.inbox.waitFor('player:interacted', (p) => p.state === 'STAND')).toEqual({
        userId: a.id,
        state: 'STAND',
      });
      expect(app!.get(PresenceStore).get(a.id)?.seatId).toBeNull();
      expect((await resync(cb)).takenSeats).toEqual([]);

      const before = cb.inbox.all('player:interacted', (p) => p.state === 'STAND').length;
      expect(await call(ca.socket, 'player:stand', {})).toEqual({ ok: true, data: {} });
      await syncPoint(cb);
      expect(cb.inbox.all('player:interacted', (p) => p.state === 'STAND')).toHaveLength(before);
    },
    CASE_MS,
  );

  it(
    'emote phát cho cả room, gồm người gửi; kind sai bị VALIDATION_FAILED',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      expect(await call(ca.socket, 'player:interact', { kind: 'WAVE' })).toEqual({ ok: true, data: {} });
      const expected = { userId: a.id, kind: 'WAVE' };
      expect(await cb.inbox.waitFor('player:interacted', (p) => p.kind === 'WAVE')).toEqual(expected);
      expect(await ca.inbox.waitFor('player:interacted', (p) => p.kind === 'WAVE')).toEqual(expected);

      expect(await call(ca.socket, 'player:interact', { kind: 'DANCE' })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    },
    CASE_MS,
  );

  it(
    'world:leave trả ghế: người ở lại không còn thấy ghế trong takenSeats',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });
      expect((await resync(cb)).takenSeats).toEqual([{ seatId: s.id, userId: a.id }]);

      expect(await call(ca.socket, 'world:leave', {})).toEqual({ ok: true, data: {} });
      await cb.inbox.waitFor('player:left', (e) => e.userId === a.id);
      expect((await resync(cb)).takenSeats).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'server:switch trả ghế ở server cũ; ở server mới không ngồi',
    async () => {
      await boot();
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, x.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, x.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });

      expect(await call(ca.socket, 'server:switch', { targetServerId: y.id })).toMatchObject({
        ok: true,
        data: { serverId: y.id, self: { seatId: null } },
      });
      await cb.inbox.waitFor('player:left', (e) => e.userId === a.id);
      expect((await resync(cb)).takenSeats).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'tab mới cùng session giữ ghế và vị trí: WorldState của tab mới có self.seatId và takenSeats',
    async () => {
      await boot();
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const a1 = await connectAs(a.id);
      await joinOk(a1, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(a1.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });

      const a2 = await connectAs(a.id);
      const state = await joinOk(a2, server.id);
      await a1.inbox.waitFor('disconnect');
      expect(state.self).toMatchObject({ userId: a.id, seatId: s.id });
      expect(state.takenSeats).toEqual([{ seatId: s.id, userId: a.id }]);
    },
    CASE_MS,
  );

  it(
    'ngắt kết nối giữ ghế và vị trí trong grace',
    async () => {
      await boot('30');
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });

      ca.socket.disconnect();
      expect(await cb.inbox.waitFor('player:interacted', (p) => p.state === 'DISCONNECTED')).toEqual({
        userId: a.id,
        state: 'DISCONNECTED',
      });
      const state = await resync(cb);
      expect(state.takenSeats).toEqual([{ seatId: s.id, userId: a.id }]);
      expect(state.players).toContainEqual(expect.objectContaining({ userId: a.id, seatId: s.id, x: s.x, y: s.y }));
    },
    CASE_MS,
  );

  it(
    'hết grace thì trả ghế: takenSeats không còn ghế đó',
    async () => {
      await boot('1');
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);
      const s = seat(SEAT_ID);
      place(a.id, s.x, s.y);
      expect(await call(ca.socket, 'player:sit', { seatId: s.id })).toMatchObject({ ok: true });

      ca.socket.disconnect();
      expect(await cb.inbox.waitFor('player:left', (e) => e.userId === a.id)).toEqual({
        userId: a.id,
        reason: 'GRACE_EXPIRED',
      });
      expect((await resync(cb)).takenSeats).toEqual([]);
      expect(app!.get(PresenceStore).get(a.id)).toBeUndefined();
    },
    CASE_MS,
  );
});
