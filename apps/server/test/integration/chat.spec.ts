import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ServerEventSchemas, displayNameKey, type Ack, type WorldState } from '@tdvh/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { ChatService, CLIENT_MSG_DEDUPE_MS, CHAT_BUFFER_MAX } from '../../src/chat/chat.service.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { CLOCK } from '../../src/core/clock.js';
import { resetDb, seedServer, testPrisma } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md M1-E4-T5 (chat:send, I2). Real socket.io-client, real PostgreSQL, no mocks.
// Only the clock is replaced: a fake clock lets the 30-second clientMsgId window be tested without waiting.
// No fixed sleeps: every wait is a waitFor with a timeout, or a round trip on the same socket.

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';
const ACK_MS = 5000;
const CASE_MS = 20000;
const SERVER_EVENTS = [...Object.keys(ServerEventSchemas), 'disconnect'];

class FakeClock {
  private t = Date.now();
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

let app: INestApplication | undefined;
let clock: FakeClock;
let url = '';
let counter = 0;
const clients: ClientSocket[] = [];

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
  clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
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

async function seedPlayer(opts: { name?: string; mutedUntil?: Date } = {}) {
  const n = ++counter;
  const displayName = opts.name ?? `Chatter${n}`;
  return testPrisma.user.create({
    data: {
      kind: 'REGISTERED',
      username: `chatuser${n}`,
      passwordHash: 'test-hash',
      mutedUntil: opts.mutedUntil ?? null,
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

async function joinOk(c: Client, serverId: string): Promise<WorldState> {
  const res = await call(c.socket, 'world:join', { serverId });
  expect(res).toMatchObject({ ok: true });
  return (res as { data: WorldState }).data;
}

// Round trip on the client's own socket: anything the server sent to it before has arrived.
async function syncPoint(c: Client): Promise<void> {
  expect(await call(c.socket, 'world:ping', {})).toEqual({ ok: true, data: {} });
}

async function say(c: Client, text: string, clientMsgId = randomUUID()): Promise<Ack<unknown>> {
  return call(c.socket, 'chat:send', { text, clientMsgId });
}

// ---- delivery ----

describe('chat:send: phát tin', () => {
  it(
    'phát tới đúng server, displayName lấy từ server, không sang server khác',
    async () => {
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer({ name: 'Ánh' });
      const b = await seedPlayer();
      const c = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      const cc = await connectAs(c.id);
      await joinOk(ca, x.id);
      await joinOk(cb, x.id);
      await joinOk(cc, y.id);

      const res = await say(ca, 'hello-x');
      expect(res).toEqual({ ok: true, data: { id: expect.any(String) } });
      const msg = await cb.inbox.waitFor('chat:message', (m) => m.text === 'hello-x');
      expect(msg).toEqual({
        id: (res as { data: { id: string } }).data.id,
        userId: a.id,
        displayName: 'Ánh',
        text: 'hello-x',
        at: expect.any(String),
      });
      await syncPoint(cc);
      expect(cc.inbox.all('chat:message')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'text được trim; rỗng, chỉ khoảng trắng, hoặc quá 200 ký tự bị VALIDATION_FAILED',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);

      const ok = await say(ca, '   trim me  ');
      expect(ok).toMatchObject({ ok: true });
      await ca.inbox.waitFor('chat:message', (m) => m.text === 'trim me');

      expect(await say(ca, '   ')).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(await say(ca, 'a'.repeat(201))).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(await say(ca, 'a'.repeat(200))).toMatchObject({ ok: true });
    },
    CASE_MS,
  );

  it(
    'client không gửi được displayName: field lạ bị VALIDATION_FAILED, không có tin nào được phát',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer({ name: 'Thật' });
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const res = await call(ca.socket, 'chat:send', {
        text: 'mạo danh',
        clientMsgId: randomUUID(),
        displayName: 'Giả',
      });
      expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      await syncPoint(cb);
      expect(cb.inbox.all('chat:message')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'nội dung HTML được giữ nguyên dạng chuỗi, không bị dựng thành HTML',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const raw = '<img src=x onerror="alert(1)"><script>x</script>';
      expect(await say(ca, raw)).toMatchObject({ ok: true });
      const msg = await cb.inbox.waitFor('chat:message', (m) => m.text === raw);
      expect(msg.text).toBe(raw);
    },
    CASE_MS,
  );
});

// ---- clientMsgId ----

describe('chat:send: clientMsgId', () => {
  it(
    'trùng clientMsgId trong 30 giây: trả id cũ và không phát lại',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const id = randomUUID();
      const first = await say(ca, 'một lần', id);
      clock.advance(CLIENT_MSG_DEDUPE_MS - 1000);
      const second = await say(ca, 'một lần', id);
      expect(second).toEqual(first);
      await syncPoint(cb);
      expect(cb.inbox.all('chat:message', (m) => m.text === 'một lần')).toHaveLength(1);
    },
    CASE_MS,
  );

  it(
    'sau 30 giây clientMsgId dùng lại là tin mới',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const id = randomUUID();
      const first = (await say(ca, 'cũ', id)) as { data: { id: string } };
      clock.advance(CLIENT_MSG_DEDUPE_MS + 1000);
      const second = (await say(ca, 'mới', id)) as { data: { id: string } };
      expect(second.data.id).not.toBe(first.data.id);
      await cb.inbox.waitFor('chat:message', (m) => m.text === 'mới');
    },
    CASE_MS,
  );

  it(
    'trùng clientMsgId của người khác không bị coi là trùng',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      const id = randomUUID();
      const fromA = (await say(ca, 'của A', id)) as { data: { id: string } };
      const fromB = (await say(cb, 'của B', id)) as { data: { id: string } };
      expect(fromB.data.id).not.toBe(fromA.data.id);
      await ca.inbox.waitFor('chat:message', (m) => m.text === 'của B');
    },
    CASE_MS,
  );
});

// ---- filter ----

describe('chat:send: lọc từ', () => {
  it(
    'cụm từ cấm được thay bằng *** dù viết hoa hay bỏ dấu; từ chứa trong từ khác không bị lọc',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      await say(ca, 'MẤT DẠY nhé');
      await say(ca, 'do ngoc!');
      await say(ca, 'đi ngủ đi');
      const got = await cb.inbox.waitFor('chat:message', (m) => m.text === 'đi ngủ đi');
      expect(got.text).toBe('đi ngủ đi');
      expect(cb.inbox.all('chat:message').map((m) => m.text)).toEqual(['*** nhé', '***!', 'đi ngủ đi']);
    },
    CASE_MS,
  );

  it(
    'lọc được cả khi cụm từ nằm giữa câu và có nhiều lần',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      await say(ca, 'a mat day b mat day c');
      await cb.inbox.waitFor('chat:message', (m) => m.text === 'a *** b *** c');
    },
    CASE_MS,
  );
});

// ---- mute ----

describe('chat:send: mute', () => {
  it(
    'user đang bị mute nhận CHAT_MUTED và tin không được phát',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer({ mutedUntil: new Date(clock.now().getTime() + 3600_000) });
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      expect(await say(ca, 'bị mute')).toMatchObject({ ok: false, error: { code: 'CHAT_MUTED' } });
      await syncPoint(cb);
      expect(cb.inbox.all('chat:message')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'mute hết hạn thì gửi được; mute có hiệu lực ngay khi DB đổi',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, server.id);
      await joinOk(cb, server.id);

      expect(await say(ca, 'trước mute')).toMatchObject({ ok: true });
      await testPrisma.user.update({
        where: { id: a.id },
        data: { mutedUntil: new Date(clock.now().getTime() + 60_000) },
      });
      expect(await say(ca, 'sau mute')).toMatchObject({ ok: false, error: { code: 'CHAT_MUTED' } });

      await testPrisma.user.update({ where: { id: a.id }, data: { mutedUntil: new Date(clock.now().getTime() - 1) } });
      expect(await say(ca, 'hết mute')).toMatchObject({ ok: true });
      await cb.inbox.waitFor('chat:message', (m) => m.text === 'hết mute');
      expect(cb.inbox.all('chat:message').map((m) => m.text)).toEqual(['trước mute', 'hết mute']);
    },
    CASE_MS,
  );
});

// ---- buffer and state ----

describe('chat: bộ đệm 50 tin', () => {
  it(
    'tối đa 50 tin mỗi server, giữ tin mới nhất theo thứ tự, và đi trong recentChat khi join',
    async () => {
      const server = await activeServer();
      const senders: Client[] = [];
      // 11 users x 5 messages = 55 messages. Each user stays under the chat:send rate limit (capacity 5).
      for (let u = 0; u < 11; u++) {
        const p = await seedPlayer();
        const c = await connectAs(p.id);
        await joinOk(c, server.id);
        senders.push(c);
      }
      let n = 0;
      for (const c of senders) {
        for (let k = 0; k < 5; k++) {
          n++;
          expect(await say(c, `m${n}`)).toMatchObject({ ok: true });
        }
      }
      expect(n).toBe(55);

      const late = await seedPlayer();
      const cl = await connectAs(late.id);
      const state = await joinOk(cl, server.id);
      expect(state.recentChat).toHaveLength(CHAT_BUFFER_MAX);
      expect(state.recentChat.map((m) => m.text)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 6}`));
    },
    CASE_MS,
  );

  it(
    'server không còn ai thì bộ đệm được giải phóng; người vào lại thấy recentChat rỗng',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer();
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);
      await say(ca, 'sẽ bị xóa');

      const chat = app!.get(ChatService);
      expect(chat.getRecent(server.id)).toHaveLength(1);

      expect(await call(ca.socket, 'world:leave', {})).toEqual({ ok: true, data: {} });
      expect(chat.getRecent(server.id)).toEqual([]);

      const ca2 = await connectAs(a.id);
      const state = await joinOk(ca2, server.id);
      expect(state.recentChat).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'findById chỉ tìm trong đúng server',
    async () => {
      const x = await activeServer();
      const y = await activeServer();
      const a = await seedPlayer();
      const b = await seedPlayer();
      const ca = await connectAs(a.id);
      const cb = await connectAs(b.id);
      await joinOk(ca, x.id);
      await joinOk(cb, y.id);

      const sent = (await say(ca, 'tìm tôi')) as { data: { id: string } };
      const chat = app!.get(ChatService);
      expect(chat.findById(x.id, sent.data.id)).toMatchObject({ text: 'tìm tôi', userId: a.id });
      expect(chat.findById(y.id, sent.data.id)).toBeUndefined();
    },
    CASE_MS,
  );

  it(
    'displayName đọc một lần khi join: đổi tên trong DB, phiên hiện tại giữ tên cũ, phiên sau thấy tên mới',
    async () => {
      const server = await activeServer();
      const a = await seedPlayer({ name: 'Cũ' });
      const b = await seedPlayer();
      const cb = await connectAs(b.id);
      await joinOk(cb, server.id);
      const ca = await connectAs(a.id);
      await joinOk(ca, server.id);

      await testPrisma.playerProfile.update({
        where: { userId: a.id },
        data: { displayName: 'Mới', displayNameKey: displayNameKey('Mới') },
      });
      await say(ca, 'trong phiên');
      expect(await cb.inbox.waitFor('chat:message', (m) => m.text === 'trong phiên')).toMatchObject({
        displayName: 'Cũ',
      });

      expect(await call(ca.socket, 'world:leave', {})).toEqual({ ok: true, data: {} });
      const ca2 = await connectAs(a.id);
      await joinOk(ca2, server.id);
      await say(ca2, 'phiên sau');
      expect(await cb.inbox.waitFor('chat:message', (m) => m.text === 'phiên sau')).toMatchObject({
        displayName: 'Mới',
      });
    },
    CASE_MS,
  );
});
