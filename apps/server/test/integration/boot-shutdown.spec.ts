import { createServer, type AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Ack } from '@tdvh/shared';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp, startApp } from '../../src/app.setup.js';
import { BootTasks } from '../../src/core/boot-tasks.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { PrismaService } from '../../src/core/prisma.service.js';
import { withTx } from '../../src/core/tx.js';
import { ReconnectService } from '../../src/session/reconnect.service.js';
import { resetDb, seedDefaultShop, seedPlot, seedProduct, seedServer, seedUser, testPrisma } from '../helpers/db.js';

// IMPLEMENTATION-PLAN.md §3.10.4, M1-E6-T1. Real HTTP, socket.io-client, PostgreSQL. No mocks.
// Not covered here: SIGTERM itself (Windows limits it). The shutdown path is app.close(), which
// enableShutdownHooks calls in main.ts. The real signal is checked at the deploy smoke test.

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';

let app: INestApplication | undefined;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  if (app && app.getHttpServer().listening) await app.close().catch(() => undefined);
  app = undefined;
});

async function build(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const built = moduleRef.createNestApplication();
  configureApp(built);
  app = built;
  return built;
}

function portOf(a: INestApplication): number {
  return (a.getHttpServer().address() as AddressInfo).port;
}

// A port that is free right now. Used so startApp receives a real, explicit port.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, LOOPBACK, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function activeServer() {
  const s = await seedServer();
  return testPrisma.gameServer.update({ where: { id: s.id }, data: { status: 'ACTIVE' } });
}

async function call(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    socket.emit(event, payload, (res: Ack<unknown>) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

describe('startApp: product floors', () => {
  it('throws and does not open the port when a product is below its floor', async () => {
    process.env.GAME_COMMISSION_BPS = '9000';
    try {
      await seedProduct('tra-da');
      const a = await build();
      await expect(startApp(a, 0)).rejects.toThrow(/below floor/);
      expect(a.getHttpServer().listening).toBe(false);
    } finally {
      delete process.env.GAME_COMMISSION_BPS;
    }
  });
});

describe('startApp: boot tasks and listen', () => {
  it('a failing boot task throws and the port stays closed', async () => {
    const a = await build();
    a.get(BootTasks).register(5, 'boom', async () => {
      throw new Error('boom');
    });
    await expect(startApp(a, await freePort())).rejects.toThrow('boom');
    expect(a.getHttpServer().listening).toBe(false);
  });

  it('ends ACTIVE sessions from before the restart before the port opens', async () => {
    const server = await seedServer();
    const user = await seedUser();
    const session = await testPrisma.serverSession.create({
      data: { userId: user.id, serverId: server.id, status: 'ACTIVE' },
    });
    const a = await build();
    const port = await freePort();
    await startApp(a, port);

    // The first request that gets through already sees the session ENDED.
    const res = await fetch(`http://${LOOPBACK}:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const row = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe('ENDED');
    expect(row.endReason).toBe('SERVER_RESTART');
  });

  it('listens on the given port on 0.0.0.0', async () => {
    const a = await build();
    const port = await freePort();
    await startApp(a, port);
    const addr = a.getHttpServer().address() as AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
    expect(addr.port).toBe(port);
  });
});

describe('shutdown (app.close)', () => {
  it('closes live sockets with a reason other than io server disconnect and keeps the session ACTIVE', async () => {
    const server = await activeServer();
    const user = await seedUser();
    const plot = await seedPlot(server.id, 'D1');
    await seedDefaultShop(server.id, plot.id, 1);
    const a = await build();
    await startApp(a, await freePort());

    const socket = connect(`http://${LOOPBACK}:${portOf(a)}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: { token: await signAccessToken(SECRET, user.id) },
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const joined = await call(socket, 'world:join', { serverId: server.id });
    expect(joined.ok).toBe(true);

    const reason = new Promise<string>((resolve) => socket.once('disconnect', (r: string) => resolve(r)));
    await a.close();

    expect(await reason).not.toBe('io server disconnect');
    expect(a.get(ReconnectService).pendingCount()).toBe(0);
    const row = await testPrisma.serverSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.status).toBe('ACTIVE');
    expect(a.getHttpServer().listening).toBe(false);
  });

  it('lets a transaction that is already running finish', async () => {
    const a = await build();
    await startApp(a, await freePort());
    const prisma = a.get(PrismaService);
    const user = await seedUser();

    let markInside!: () => void;
    const inside = new Promise<void>((resolve) => (markInside = resolve));
    const running = withTx(prisma, async (tx) => {
      markInside();
      await tx.$executeRaw`SELECT pg_sleep(0.5)`;
      return tx.user.findUniqueOrThrow({ where: { id: user.id } });
    });

    await inside;
    await a.close();
    await expect(running).resolves.toMatchObject({ id: user.id });
  });
});
