import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ListServersResSchema, QuickJoinResSchema } from '@tdvh/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { signAccessToken } from '../../src/core/jwt.js';
import { ONLINE_COUNTER } from '../../src/servers/online-counter.js';
import { loadLevel } from '../../src/servers/servers.service.js';
import { resetDb, seedPlot, seedUser, testPrisma } from '../helpers/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
const LOOPBACK = '127.0.0.1';

let app: INestApplication | undefined;
let baseUrl = '';

// counts: serverId -> online. When given, replaces the DB counter so thresholds are exact.
async function startApp(counts?: Map<string, number>): Promise<void> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (counts) {
    builder = builder.overrideProvider(ONLINE_COUNTER).useValue({
      count: async (serverId: string) => counts.get(serverId) ?? 0,
    });
  }
  const moduleRef = await builder.compile();
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

const tokenFor = (userId: string): Promise<string> => signAccessToken(SECRET, userId);

async function getJson(path: string, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function postJson(path: string, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function createServer(slug: string, opts: { status?: 'ACTIVE' | 'PROVISIONING' | 'DRAINING' | 'CLOSED'; softCap?: number } = {}) {
  return testPrisma.gameServer.create({
    data: {
      slug,
      name: slug,
      worldMapId: 'street-01',
      status: opts.status ?? 'ACTIVE',
      softCap: opts.softCap ?? 100,
      // Schema CHECK GameServer_caps_valid needs softCap <= hardCap; default hardCap is 25.
      hardCap: opts.softCap ?? 100,
    },
  });
}

async function ensureWorldMap(): Promise<void> {
  await testPrisma.worldMap.upsert({
    where: { id: 'street-01' },
    create: { id: 'street-01', version: 1 },
    update: {},
  });
}

describe('servers (M1-E2-T2)', () => {
  beforeEach(async () => {
    await resetDb();
    await ensureWorldMap();
  });

  afterEach(async () => {
    await stopApp();
  });

  it('GET /servers lists only ACTIVE servers, with exactly the ServerCard fields', async () => {
    await createServer('active-a');
    await createServer('provisioning', { status: 'PROVISIONING' });
    await createServer('closed', { status: 'CLOSED' });
    await createServer('draining', { status: 'DRAINING' });
    const user = await seedUser();
    await startApp(new Map());

    const res = await getJson('/servers', await tokenFor(user.id));
    expect(res.status).toBe(200);
    const parsed = ListServersResSchema.parse(res.body);
    expect(parsed.items.map((i) => i.slug)).toEqual(['active-a']);
    expect(Object.keys(parsed.items[0]).sort()).toEqual(
      ['activeShops', 'freePlots', 'id', 'load', 'name', 'online', 'slug'].sort(),
    );
  });

  it('GET /servers requires auth', async () => {
    await startApp(new Map());
    const res = await getJson('/servers');
    expect(res.status).toBe(401);
    expect((res.body.error as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('load is LOW below 40%, MEDIUM from 40% to below 75%, HIGH from 75%; threshold edges 39, 40, 74, 75 of softCap 100', async () => {
    const ids = new Map<number, string>();
    const counts = new Map<string, number>();
    for (const n of [39, 40, 74, 75]) {
      const s = await createServer(`load-${n}`, { softCap: 100 });
      ids.set(n, s.id);
      counts.set(s.id, n);
    }
    const user = await seedUser();
    await startApp(counts);

    const res = await getJson('/servers', await tokenFor(user.id));
    const items = ListServersResSchema.parse(res.body).items;
    const loadOf = (n: number) => items.find((i) => i.id === ids.get(n))?.load;
    expect(loadOf(39)).toBe('LOW');
    expect(loadOf(40)).toBe('MEDIUM');
    expect(loadOf(74)).toBe('MEDIUM');
    expect(loadOf(75)).toBe('HIGH');
    expect(items.find((i) => i.id === ids.get(75))?.online).toBe(75);
  });

  it('loadLevel uses integer math at the thresholds', () => {
    expect(loadLevel(0, 15)).toBe('LOW');
    expect(loadLevel(5, 15)).toBe('LOW'); // 33.3%
    expect(loadLevel(6, 15)).toBe('MEDIUM'); // exactly 40%
  });

  it('freePlots counts PURCHASABLE plots with no shop that is not CLOSED; activeShops counts shops not CLOSED', async () => {
    const server = await createServer('plots');
    const owner = await seedUser();
    // Schema allows one live shop per owner (Shop_one_live_per_owner), so each shop gets its own owner.
    const owners = [await seedUser(), await seedUser(), await seedUser()];
    await seedPlot(server.id, 'P1'); // no shop: free
    const plotOpen = await seedPlot(server.id, 'P2'); // OPEN shop: taken
    const plotClosed = await seedPlot(server.id, 'P3'); // only CLOSED shop: free
    const plotPaused = await seedPlot(server.id, 'P4'); // PAUSED shop: taken
    await seedPlot(server.id, 'P5'); // still free
    const mk = (plotId: string, ownerId: string, name: string, status: 'OPEN' | 'PAUSED' | 'CLOSED') =>
      testPrisma.shop.create({
        data: { serverId: server.id, plotId, type: 'PLAYER_OWNED', ownerId, name, status },
      });
    await mk(plotOpen.id, owners[0].id, 'Quan Mo', 'OPEN');
    await mk(plotClosed.id, owners[1].id, 'Quan Dong', 'CLOSED');
    await mk(plotPaused.id, owners[2].id, 'Quan Nghi', 'PAUSED');
    await startApp(new Map());

    const res = await getJson('/servers', await tokenFor(owner.id));
    const card = ListServersResSchema.parse(res.body).items[0];
    expect(card.freePlots).toBe(3); // P1, P3, P5
    expect(card.activeShops).toBe(2); // OPEN + PAUSED
  });

  it('GET /servers never returns player data', async () => {
    const server = await createServer('privacy');
    const user = await seedUser('secretname');
    await testPrisma.serverSession.create({ data: { userId: user.id, serverId: server.id } });
    await startApp();

    const res = await getJson('/servers', await tokenFor(user.id));
    expect(JSON.stringify(res.body)).not.toContain('secretname');
    expect(JSON.stringify(res.body)).not.toContain(user.id);
    const card = ListServersResSchema.parse(res.body).items[0];
    expect(card.online).toBe(1); // DB counter: one ACTIVE session
  });

  it('online counts ACTIVE ServerSession rows only (DB counter)', async () => {
    const server = await createServer('online-db');
    const users = [await seedUser(), await seedUser(), await seedUser()];
    await testPrisma.serverSession.create({ data: { userId: users[0].id, serverId: server.id } });
    await testPrisma.serverSession.create({ data: { userId: users[1].id, serverId: server.id } });
    await testPrisma.serverSession.create({
      data: { userId: users[2].id, serverId: server.id, status: 'ENDED', endReason: 'LEFT', endedAt: new Date() },
    });
    await startApp();

    const res = await getJson('/servers', await tokenFor(users[0].id));
    expect(ListServersResSchema.parse(res.body).items[0].online).toBe(2);
  });

  it('POST /servers/quick-join picks the ACTIVE server with the most online players below softCap', async () => {
    const a = await createServer('qa', { softCap: 10 });
    const b = await createServer('qb', { softCap: 10 });
    const c = await createServer('qc', { softCap: 10 }); // full
    const d = await createServer('qd', { softCap: 10, status: 'PROVISIONING' }); // not ACTIVE
    const user = await seedUser();
    await startApp(new Map([[a.id, 5], [b.id, 8], [c.id, 10], [d.id, 9]]));

    const sessionsBefore = await testPrisma.serverSession.count();
    const res = await postJson('/servers/quick-join', await tokenFor(user.id));
    expect(res.status).toBe(200);
    expect(QuickJoinResSchema.parse(res.body)).toEqual({ serverId: b.id });
    expect(await testPrisma.serverSession.count()).toBe(sessionsBefore); // no session created
  });

  it('POST /servers/quick-join returns SERVER_FULL when every ACTIVE server is at softCap', async () => {
    const a = await createServer('full-a', { softCap: 3 });
    const user = await seedUser();
    await startApp(new Map([[a.id, 3]]));

    const res = await postJson('/servers/quick-join', await tokenFor(user.id));
    expect(res.status).toBe(400);
    expect((res.body.error as { code: string }).code).toBe('SERVER_FULL');
  });

  it('POST /servers/quick-join returns SERVER_FULL when there is no ACTIVE server', async () => {
    await createServer('none', { status: 'CLOSED' });
    const user = await seedUser();
    await startApp(new Map());

    const res = await postJson('/servers/quick-join', await tokenFor(user.id));
    expect((res.body.error as { code: string }).code).toBe('SERVER_FULL');
  });

  it('POST /servers/quick-join requires auth', async () => {
    await startApp(new Map());
    const res = await postJson('/servers/quick-join');
    expect(res.status).toBe(401);
  });
});
