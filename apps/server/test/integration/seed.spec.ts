import { loadGameConfig } from '../../src/core/game-config.js';
import { seed } from '../../prisma/seed.js';
import { resetDb, testPrisma } from '../helpers/db.js';

const cfg = loadGameConfig({});

describe('seed', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates WorldMap street-01 v1 and the 3 catalog products', async () => {
    await seed(testPrisma, cfg);
    expect(await testPrisma.worldMap.findUnique({ where: { id: 'street-01' } })).toMatchObject({ version: 1 });
    const products = await testPrisma.product.findMany({ orderBy: { id: 'asc' } });
    expect(products).toEqual([
      { id: 'huong-duong', name: 'Hạt hướng dương', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
      { id: 'tra-chanh', name: 'Trà chanh', supplyCost: 30n, minPrice: 40n, defaultPrice: 150n, maxPrice: 400n },
      { id: 'tra-da', name: 'Trà đá', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
    ]);
  });

  it('running twice creates no duplicates', async () => {
    await seed(testPrisma, cfg);
    await seed(testPrisma, cfg);
    expect(await testPrisma.worldMap.count()).toBe(1);
    expect(await testPrisma.product.count()).toBe(3);
  });

  it('does not overwrite WorldMap version on re-run', async () => {
    await seed(testPrisma, cfg);
    await testPrisma.worldMap.update({ where: { id: 'street-01' }, data: { version: 5 } });
    await seed(testPrisma, cfg);
    expect(await testPrisma.worldMap.findUnique({ where: { id: 'street-01' } })).toMatchObject({ version: 5 });
  });

  it('resets catalog fields to the §3.9 values on re-run', async () => {
    await seed(testPrisma, cfg);
    await testPrisma.product.update({ where: { id: 'tra-da' }, data: { defaultPrice: 999n } });
    await seed(testPrisma, cfg);
    expect((await testPrisma.product.findUnique({ where: { id: 'tra-da' } }))?.defaultPrice).toBe(100n);
  });

  it('creates no game server, shop, user or order', async () => {
    await seed(testPrisma, cfg);
    expect(await testPrisma.gameServer.count()).toBe(0);
    expect(await testPrisma.shop.count()).toBe(0);
    expect(await testPrisma.user.count()).toBe(0);
    expect(await testPrisma.shopOrder.count()).toBe(0);
  });

  it('writes nothing when the product floors fail', async () => {
    await expect(seed(testPrisma, loadGameConfig({ GAME_COMMISSION_BPS: '9000' }))).rejects.toThrow(/tra-da/);
    expect(await testPrisma.product.count()).toBe(0);
    expect(await testPrisma.worldMap.count()).toBe(0);
  });
});
