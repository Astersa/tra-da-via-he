import { loadGameConfig } from '../../src/core/game-config.js';
import { ServerProvisioningService } from '../../src/servers/server-provisioning.service.js';
import { seed } from '../../prisma/seed.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { raceAll } from '../helpers/race.js';

// Real PostgreSQL on port 5433. No mocks: the slug unique index decides the winner.

const cfg = loadGameConfig({});

describe('ServerProvisioningService.provision concurrency', () => {
  beforeEach(async () => {
    await resetDb();
    await seed(testPrisma, cfg);
  });

  it('5 concurrent provisions of the same slug create exactly 1 server with 3 DEFAULT shops', async () => {
    const svc = new ServerProvisioningService(testPrisma, cfg);
    const results = await raceAll(Array.from({ length: 5 }, () => () => svc.provision({ slug: 'race', name: 'Race' })));

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/GameServer_slug_key|Unique constraint/);
    }

    expect(await testPrisma.gameServer.count({ where: { slug: 'race' } })).toBe(1);
    expect(await testPrisma.shop.count({ where: { type: 'DEFAULT' } })).toBe(3);
    expect(await testPrisma.shopTreasury.count()).toBe(3);
    expect(await testPrisma.shopMenu.count()).toBe(9);
    expect(await testPrisma.shopPlot.count()).toBe(3 + cfg.purchasablePlots);
  });
});
