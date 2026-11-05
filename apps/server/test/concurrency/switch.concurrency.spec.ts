import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../src/core/clock.js';
import { withTx } from '../../src/core/tx.js';
import { SessionService } from '../../src/session/session.service.js';
import type { ServerContext } from '../../src/session/server-context.js';
import { raceAll } from '../helpers/race.js';
import { resetDb, seedServer, seedUser, testPrisma } from '../helpers/db.js';

const clock: Clock = { now: () => new Date('2026-11-05T03:00:00.000Z') };
const svc = (): SessionService => new SessionService(testPrisma, clock);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Server in status ACTIVE with the schema defaults (softCap 15, hardCap 25).
async function activeServer() {
  const s = await seedServer();
  return testPrisma.gameServer.update({ where: { id: s.id }, data: { status: 'ACTIVE' } });
}

async function fillSessions(serverId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const u = await seedUser();
    await testPrisma.serverSession.create({ data: { userId: u.id, serverId } });
  }
}

async function activeOf(userId: string) {
  return testPrisma.serverSession.findMany({ where: { userId, status: 'ACTIVE' } });
}

beforeEach(async () => {
  await resetDb();
});

describe('join concurrency', () => {
  it('10 parallel joins by one user across 2 servers: no error, exactly one ACTIVE session', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();

    const results = await raceAll(
      Array.from({ length: 10 }, (_, i) => () => svc().join(user.id, i % 2 === 0 ? a.id : b.id)),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const active = await activeOf(user.id);
    expect(active).toHaveLength(1);
    expect([a.id, b.id]).toContain(active[0]?.serverId);
  });

  it('5 parallel joins by one user when only 1 slot is left: no error, one ACTIVE, server at hardCap', async () => {
    const server = await activeServer();
    await fillSessions(server.id, server.hardCap - 1);
    const user = await seedUser();

    const results = await raceAll(Array.from({ length: 5 }, () => () => svc().join(user.id, server.id)));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await activeOf(user.id)).toHaveLength(1);
    expect(await testPrisma.serverSession.count({ where: { serverId: server.id, status: 'ACTIVE' } })).toBe(
      server.hardCap,
    );
  });
});

describe('switch concurrency', () => {
  it('a FOR SHARE holder makes the switch wait; a command after the switch gets SESSION_STALE', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);
    const ctx: ServerContext = { serverId: a.id, userId: user.id, sessionId: first.session.id };

    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withTx(testPrisma, async (tx) => {
      await svc().assertSessionActive(tx, ctx);
      markLocked();
      await releaseGate;
    });
    await locked;

    let switchDone = false;
    const switching = svc()
      .switchTo(user.id, first.session.id, b.id)
      .then((r) => {
        switchDone = true;
        return r;
      });
    await sleep(300);
    expect(switchDone).toBe(false);

    release();
    await expect(holder).resolves.toBeUndefined();
    const res = await switching;
    expect(res.ended).toEqual({ id: first.session.id, serverId: a.id });

    await expect(withTx(testPrisma, (tx) => svc().assertSessionActive(tx, ctx))).rejects.toMatchObject({
      code: 'SESSION_STALE',
    });
    expect(await activeOf(user.id)).toHaveLength(1);
  });

  it('two parallel switches of one user from the same session: one wins, the other gets SESSION_STALE', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    const results = await raceAll([
      () => svc().switchTo(user.id, first.session.id, b.id),
      () => svc().switchTo(user.id, first.session.id, b.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'SESSION_STALE' });
    const active = await activeOf(user.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.serverId).toBe(b.id);
  });

  it('opposite switches A to B and B to A by two users run together without deadlock, 5 rounds', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const u1 = await seedUser();
    const u2 = await seedUser();
    await svc().join(u1.id, a.id);
    await svc().join(u2.id, b.id);

    for (let round = 0; round < 5; round++) {
      const [s1] = await activeOf(u1.id);
      const [s2] = await activeOf(u2.id);
      if (!s1 || !s2) throw new Error('missing active session before round');
      const target1 = s1.serverId === a.id ? b.id : a.id;
      const target2 = s2.serverId === a.id ? b.id : a.id;

      const results = await raceAll([
        () => svc().switchTo(u1.id, s1.id, target1),
        () => svc().switchTo(u2.id, s2.id, target2),
      ]);

      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(await activeOf(u1.id)).toHaveLength(1);
      expect(await activeOf(u2.id)).toHaveLength(1);
    }
  });
});
