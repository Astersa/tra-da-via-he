import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../src/core/clock.js';
import { withTx } from '../../src/core/tx.js';
import { SessionService } from '../../src/session/session.service.js';
import type { ServerContext } from '../../src/session/server-context.js';
import { resetDb, seedServer, seedUser, testPrisma } from '../helpers/db.js';

const NOW = new Date('2026-11-05T03:00:00.000Z');
const clock: Clock = { now: () => NOW };
const svc = (): SessionService => new SessionService(testPrisma, clock);

// Server in status ACTIVE with the schema defaults (softCap 15, hardCap 25).
async function activeServer() {
  const s = await seedServer();
  return testPrisma.gameServer.update({ where: { id: s.id }, data: { status: 'ACTIVE' } });
}

// Fills a server with `n` ACTIVE sessions of other users, without going through the service.
async function fillSessions(serverId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const u = await seedUser();
    await testPrisma.serverSession.create({ data: { userId: u.id, serverId } });
  }
}

beforeEach(async () => {
  await resetDb();
});

describe('SessionService.join', () => {
  it('creates an ACTIVE session stamped by Clock', async () => {
    const server = await activeServer();
    const user = await seedUser();

    const res = await svc().join(user.id, server.id);

    expect(res.reused).toBe(false);
    expect(res.ended).toBeUndefined();
    expect(res.session).toMatchObject({ userId: user.id, serverId: server.id, status: 'ACTIVE', endReason: null });
    expect(res.session.startedAt).toEqual(NOW);
  });

  it('reuses the ACTIVE session when joining the same server again', async () => {
    const server = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, server.id);

    const again = await svc().join(user.id, server.id);

    expect(again.reused).toBe(true);
    expect(again.session.id).toBe(first.session.id);
    expect(await testPrisma.serverSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it('ends the old session with REPLACED when joining another server, and keeps its row', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    const res = await svc().join(user.id, b.id);

    expect(res.reused).toBe(false);
    expect(res.ended).toEqual({ id: first.session.id, serverId: a.id });
    const old = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(old).toMatchObject({ status: 'ENDED', endReason: 'REPLACED' });
    expect(old.endedAt).toEqual(NOW);
    expect(await testPrisma.serverSession.count({ where: { userId: user.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('rejects an unknown server with SERVER_NOT_FOUND', async () => {
    const user = await seedUser();
    await expect(svc().join(user.id, randomUUID())).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  });

  it('rejects a server that is not ACTIVE with SERVER_NOT_ACTIVE', async () => {
    const server = await seedServer(); // PROVISIONING by default
    const user = await seedUser();
    await expect(svc().join(user.id, server.id)).rejects.toMatchObject({ code: 'SERVER_NOT_ACTIVE' });
    expect(await testPrisma.serverSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not block at softCap (softCap only drives load level)', async () => {
    const server = await activeServer();
    await fillSessions(server.id, server.softCap);
    const user = await seedUser();

    const res = await svc().join(user.id, server.id);

    expect(res.session.status).toBe('ACTIVE');
  });

  it('rejects with SERVER_FULL when the server is already at hardCap', async () => {
    const server = await activeServer();
    await fillSessions(server.id, server.hardCap);
    const user = await seedUser();

    await expect(svc().join(user.id, server.id)).rejects.toMatchObject({ code: 'SERVER_FULL' });
    expect(await testPrisma.serverSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('keeps the old session when joining a full server from another server (rollback)', async () => {
    const a = await activeServer();
    const b = await activeServer();
    await fillSessions(b.id, b.hardCap);
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    await expect(svc().join(user.id, b.id)).rejects.toMatchObject({ code: 'SERVER_FULL' });

    const still = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(still).toMatchObject({ status: 'ACTIVE', endReason: null });
  });
});

describe('SessionService.switchTo', () => {
  it('ends the current session with SWITCHED and opens an ACTIVE one on the target', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    const res = await svc().switchTo(user.id, first.session.id, b.id);

    expect(res.ended).toEqual({ id: first.session.id, serverId: a.id });
    expect(res.session).toMatchObject({ serverId: b.id, status: 'ACTIVE' });
    const old = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(old).toMatchObject({ status: 'ENDED', endReason: 'SWITCHED' });
    expect(old.endedAt).toEqual(NOW);
  });

  it('rejects switching to the server the user is already in with ALREADY_IN_SERVER', async () => {
    const a = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    await expect(svc().switchTo(user.id, first.session.id, a.id)).rejects.toMatchObject({
      code: 'ALREADY_IN_SERVER',
    });
    const still = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(still.status).toBe('ACTIVE');
  });

  it('rejects a target that is not ACTIVE with SERVER_NOT_ACTIVE', async () => {
    const a = await activeServer();
    const closed = await seedServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);

    await expect(svc().switchTo(user.id, first.session.id, closed.id)).rejects.toMatchObject({
      code: 'SERVER_NOT_ACTIVE',
    });
  });

  it('rejects a stale current session with SESSION_STALE', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);
    await svc().switchTo(user.id, first.session.id, b.id);

    await expect(svc().switchTo(user.id, first.session.id, a.id)).rejects.toMatchObject({ code: 'SESSION_STALE' });
  });
});

describe('SessionService.leave and endAllOnBoot', () => {
  it('leave ends the session with the given reason and keeps the row', async () => {
    const server = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, server.id);

    await svc().leave(user.id, first.session.id, 'LEFT');

    const row = await testPrisma.serverSession.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(row).toMatchObject({ status: 'ENDED', endReason: 'LEFT' });
    expect(row.endedAt).toEqual(NOW);
  });

  it('endAllOnBoot ends every ACTIVE session with SERVER_RESTART and returns the count', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const u1 = await seedUser();
    const u2 = await seedUser();
    await svc().join(u1.id, a.id);
    await svc().join(u2.id, b.id);

    expect(await svc().endAllOnBoot()).toBe(2);

    const rows = await testPrisma.serverSession.findMany();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ status: 'ENDED', endReason: 'SERVER_RESTART' });
    expect(await svc().endAllOnBoot()).toBe(0);
  });
});

describe('SessionService.assertSessionActive', () => {
  it('passes for the ACTIVE session on its server and fails with SESSION_STALE after a switch', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);
    const ctx: ServerContext = { serverId: a.id, userId: user.id, sessionId: first.session.id };

    await expect(withTx(testPrisma, (tx) => svc().assertSessionActive(tx, ctx))).resolves.toBeUndefined();

    await svc().switchTo(user.id, first.session.id, b.id);

    await expect(withTx(testPrisma, (tx) => svc().assertSessionActive(tx, ctx))).rejects.toMatchObject({
      code: 'SESSION_STALE',
    });
  });

  it('fails with SESSION_STALE when the context names a different server', async () => {
    const a = await activeServer();
    const b = await activeServer();
    const user = await seedUser();
    const first = await svc().join(user.id, a.id);
    const ctx: ServerContext = { serverId: b.id, userId: user.id, sessionId: first.session.id };

    await expect(withTx(testPrisma, (tx) => svc().assertSessionActive(tx, ctx))).rejects.toMatchObject({
      code: 'SESSION_STALE',
    });
  });
});
