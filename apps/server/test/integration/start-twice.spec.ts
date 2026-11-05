import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../../src/core/jwt.js';
import { resetDb, seedDefaultShop, seedPlot, seedServer, testPrisma } from '../helpers/db.js';
import { displayNameKey, type Ack } from '@tdvh/shared';

// IMPLEMENTATION-PLAN.md §3.10.3 and §3.10.4 (M1-E6-T3). Real processes, real PostgreSQL on port 5433, no mocks.
// The start command is read from render.yaml, so the test runs exactly what Render runs.
// Needs `pnpm -r build` first (dist/main.js and apps/web/dist).

const REPO = path.resolve(import.meta.dirname, '../../../..');
const SERVER_DIR = path.join(REPO, 'apps/server');
const LOOPBACK = '127.0.0.1';
const SECRET = process.env.JWT_SECRET ?? '';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const renderYaml = readFileSync(path.join(REPO, 'render.yaml'), 'utf8');
const START_COMMAND = /\n\s+startCommand: (.+)\n/.exec(renderYaml)?.[1] ?? '';

const children: ChildProcess[] = [];
const clients: ClientSocket[] = [];

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) await stop(child);
  }
});

// A port that is free right now.
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

// Runs the start command from render.yaml through bash, the same shell Render uses on Linux.
// Windows has no POSIX shell for `exec`; bash from Git for Windows is used there, so the start path is checked
// but the signal behaviour is not (see describe.runIf below).
function startServer(port: number): { child: ChildProcess; output: () => string } {
  let out = '';
  const child = spawn('bash', ['-c', START_COMMAND], {
    cwd: REPO,
    env: {
      ...process.env,
      DATABASE_URL,
      JWT_SECRET: SECRET,
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  children.push(child);
  return { child, output: () => out };
}

async function waitForHealth(port: number, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}):\n${output()}`);
    try {
      const res = await fetch(`http://${LOOPBACK}:${port}/api/v1/health`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`health not reached on ${port}:\n${output()}`);
}

// Stops the process and waits for exit. Windows does not deliver SIGTERM, so the tree is killed with taskkill.
function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGTERM');
    }
  });
}

function exited(child: ChildProcess, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function migrateDeploy(): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function seedPlayer(name: string) {
  return testPrisma.user.create({
    data: {
      kind: 'REGISTERED',
      username: name,
      passwordHash: 'test-hash',
      wallet: { create: { balance: 0n } },
      profile: { create: { displayName: name, displayNameKey: displayNameKey(name), avatarId: 'avatar_01' } },
    },
  });
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

describe('render.yaml start command (§3.10.3, §3.10.4)', () => {
  it('prisma migrate deploy runs twice in a row: both exit 0, the second applies nothing', () => {
    const first = migrateDeploy();
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const second = migrateDeploy();
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(second.stdout).toMatch(/No pending migrations/i);
  }, 120_000);

  it('starts, serves health, stops, starts again; the session from run 1 is ENDED by boot', async () => {
    const server = await seedServer();
    await testPrisma.gameServer.update({ where: { id: server.id }, data: { status: 'ACTIVE' } });
    const plot = await seedPlot(server.id, 'D1');
    await seedDefaultShop(server.id, plot.id, 1);
    const user = await seedPlayer('StartTwice');

    // Run 1: the player joins, so an ACTIVE session exists when the process stops.
    const port1 = await freePort();
    const run1 = startServer(port1);
    await waitForHealth(port1, run1.child, run1.output);
    const socket = connect(`http://${LOOPBACK}:${port1}`, {
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
    socket.disconnect();
    await stop(run1.child);
    const before = await testPrisma.serverSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(before.status).toBe('ACTIVE');

    // Run 2: boot tasks end the session before the port opens.
    const port2 = await freePort();
    const run2 = startServer(port2);
    await waitForHealth(port2, run2.child, run2.output);
    const res = await fetch(`http://${LOOPBACK}:${port2}/api/v1/health`);
    expect(res.status).toBe(200);
    const after = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe('ENDED');
    expect(after.endReason).toBe('SERVER_RESTART');
  }, 180_000);

  describe.runIf(process.platform !== 'win32')('signal (Linux only: Windows does not deliver SIGTERM)', () => {
    it('exits within 30 seconds of SIGTERM', async () => {
      const port = await freePort();
      const run = startServer(port);
      await waitForHealth(port, run.child, run.output);
      const t0 = Date.now();
      run.child.kill('SIGTERM');
      expect(await exited(run.child, 30_000)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(30_000);
    }, 180_000);
  });
});
