import { loadGameConfig, type GameConfig } from '../../src/core/game-config.js';
import { ServerProvisioningService } from '../../src/servers/server-provisioning.service.js';
import { seed } from '../../prisma/seed.js';
import { expectDbError, resetDb, testPrisma } from '../helpers/db.js';

const cfg = loadGameConfig({});
const DEFAULT_NAMES = ['Quán Cô Ba', 'Trà Đá Góc Phố', 'Quán Ông Tư'];

function service(config: GameConfig = cfg): ServerProvisioningService {
  return new ServerProvisioningService(testPrisma, config);
}

describe('ServerProvisioningService.provision', () => {
  beforeEach(async () => {
    await resetDb();
    await seed(testPrisma, cfg);
  });

  it('creates exactly 3 DEFAULT shops on D1..D3 with defaultSlot 1..3', async () => {
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    const shops = await testPrisma.shop.findMany({
      where: { serverId: server.id, type: 'DEFAULT' },
      include: { plot: true },
      orderBy: { defaultSlot: 'asc' },
    });
    expect(shops).toHaveLength(3);
    expect(shops.map((s) => s.defaultSlot)).toEqual([1, 2, 3]);
    expect(shops.map((s) => s.plot.mapSlot)).toEqual(['D1', 'D2', 'D3']);
    expect(new Set(shops.map((s) => s.name))).toEqual(new Set(DEFAULT_NAMES));
    expect(await testPrisma.shop.count({ where: { serverId: server.id } })).toBe(3);
  });

  it('creates 3 treasuries with balance 0, and no DEFAULT shop has an owner', async () => {
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    const treasuries = await testPrisma.shopTreasury.findMany({ where: { shop: { serverId: server.id } } });
    expect(treasuries).toHaveLength(3);
    expect(treasuries.every((t) => t.balance === 0n)).toBe(true);

    const shops = await testPrisma.shop.findMany({ where: { serverId: server.id } });
    expect(shops.every((s) => s.ownerId === null)).toBe(true);
  });

  it('creates 9 menu rows: each DEFAULT shop sells all 3 products at the catalog defaultPrice', async () => {
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    const menu = await testPrisma.shopMenu.findMany({
      where: { shop: { serverId: server.id } },
      include: { product: true },
    });
    expect(menu).toHaveLength(9);
    for (const m of menu) {
      expect(m.price).toBe(m.product.defaultPrice);
    }
    const shopIds = new Set(menu.map((m) => m.shopId));
    expect(shopIds.size).toBe(3);
    for (const shopId of shopIds) {
      expect(menu.filter((m) => m.shopId === shopId).map((m) => m.productId).sort()).toEqual([
        'huong-duong',
        'tra-chanh',
        'tra-da',
      ]);
    }
  });

  it('reads the menu price from the Product table, not a hard-coded value', async () => {
    await testPrisma.product.update({ where: { id: 'tra-da' }, data: { defaultPrice: 120n } });
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    const row = await testPrisma.shopMenu.findFirst({
      where: { shop: { serverId: server.id }, productId: 'tra-da' },
    });
    expect(row?.price).toBe(120n);
  });

  it('creates 7 plots: 3 RESERVED_DEFAULT with fee 0, and purchasablePlots PURCHASABLE with shopOpenFee', async () => {
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    const plots = await testPrisma.shopPlot.findMany({ where: { serverId: server.id }, orderBy: { mapSlot: 'asc' } });
    expect(plots).toHaveLength(3 + cfg.purchasablePlots);
    const reserved = plots.filter((p) => p.kind === 'RESERVED_DEFAULT');
    expect(reserved.map((p) => p.mapSlot).sort()).toEqual(['D1', 'D2', 'D3']);
    expect(reserved.every((p) => p.openFee === 0n)).toBe(true);
    const purchasable = plots.filter((p) => p.kind === 'PURCHASABLE');
    expect(purchasable).toHaveLength(cfg.purchasablePlots);
    expect(purchasable.every((p) => p.openFee === cfg.shopOpenFee)).toBe(true);
  });

  it('takes purchasablePlots, softCap and hardCap from GAME_CONFIG', async () => {
    const custom = loadGameConfig({ GAME_PURCHASABLE_PLOTS: '2', GAME_SOFT_CAP: '10', GAME_HARD_CAP: '20' });
    const server = await service(custom).provision({ slug: 'cfg-server', name: 'Cấu hình' });

    expect(server).toMatchObject({ softCap: 10, hardCap: 20 });
    expect(await testPrisma.shopPlot.count({ where: { serverId: server.id } })).toBe(3 + 2);
  });

  it('returns an ACTIVE server on world map street-01', async () => {
    const server = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    expect(server).toMatchObject({ slug: 'pho-co', name: 'Phố Cổ', status: 'ACTIVE', worldMapId: 'street-01' });
    expect(await testPrisma.gameServer.findUnique({ where: { id: server.id } })).toMatchObject({ status: 'ACTIVE' });
  });

  it('rolls back everything when a step fails midway (catalog missing at the menu step)', async () => {
    // Plots, shops and treasuries are written before the menu step reads Product.
    await testPrisma.shopMenu.deleteMany();
    await testPrisma.product.deleteMany();

    await expect(service().provision({ slug: 'half', name: 'Dở dang' })).rejects.toThrow(/tra-da/);

    expect(await testPrisma.gameServer.count()).toBe(0);
    expect(await testPrisma.shopPlot.count()).toBe(0);
    expect(await testPrisma.shop.count()).toBe(0);
    expect(await testPrisma.shopTreasury.count()).toBe(0);
    expect(await testPrisma.shopMenu.count()).toBe(0);
  });

  it('throws a clear error and creates nothing when WorldMap street-01 is not seeded', async () => {
    await testPrisma.shopMenu.deleteMany();
    await testPrisma.shopTreasury.deleteMany();
    await testPrisma.shop.deleteMany();
    await testPrisma.shopPlot.deleteMany();
    await testPrisma.gameServer.deleteMany();
    await testPrisma.product.deleteMany();
    await testPrisma.worldMap.deleteMany();

    await expect(service().provision({ slug: 'no-map', name: 'Không map' })).rejects.toThrow(/street-01/);
    expect(await testPrisma.gameServer.count()).toBe(0);
  });

  it('rejects a duplicate slug with a unique violation and keeps the first server only', async () => {
    const first = await service().provision({ slug: 'pho-co', name: 'Phố Cổ' });

    await expectDbError(() => service().provision({ slug: 'pho-co', name: 'Trùng' }), {
      sqlstate: '23505',
      text: 'GameServer_slug_key',
    });

    expect(await testPrisma.gameServer.count()).toBe(1);
    expect(await testPrisma.shop.count({ where: { serverId: first.id } })).toBe(3);
    expect(await testPrisma.shop.count()).toBe(3);
  });

  it('provisions two independent servers, each with its own 3 DEFAULT shops and 7 plots', async () => {
    const a = await service().provision({ slug: 'server-a', name: 'A' });
    const b = await service().provision({ slug: 'server-b', name: 'B' });

    expect(a.id).not.toBe(b.id);
    for (const s of [a, b]) {
      expect(await testPrisma.shop.count({ where: { serverId: s.id, type: 'DEFAULT' } })).toBe(3);
      expect(await testPrisma.shopPlot.count({ where: { serverId: s.id } })).toBe(3 + cfg.purchasablePlots);
    }
    expect(await testPrisma.shop.count({ where: { ownerId: { not: null } } })).toBe(0);
  });
});
