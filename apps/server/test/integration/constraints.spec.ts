import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  expectDbError,
  futureDate,
  resetDb,
  seedDefaultShop,
  seedGuest,
  seedPlayerShop,
  seedPlot,
  seedProduct,
  seedServer,
  seedUser,
  testPrisma,
} from '../helpers/db.js';

// §3.2.3: names copied from the raw SQL block in the plan.
const PARTIAL_UNIQUE = [
  'ServerSession_one_active_per_user',
  'ShopEmployee_one_active_per_user',
  'EmployeeApplication_one_pending',
  'Shop_one_live_per_plot',
  'Shop_one_live_per_owner',
  'Shop_default_slot_per_server',
];
const PARTIAL_INDEX = ['ShopOrder_open_by_shop', 'ShopOrder_pending_expiry', 'ShopOrder_accept_expiry'];
const CHECKS = [
  'User_kind_credentials',
  'Wallet_balance_nonneg',
  'Wallet_held_valid',
  'ShopTreasury_balance_nonneg',
  'Shop_type_owner_slot',
  'ShopOrder_no_self_purchase',
  'ShopOrder_no_self_handle',
  'ShopOrder_handler_required',
  'ShopOrder_amounts_valid',
  'ShopOrder_settlement_valid',
  'ShopOrderItem_valid',
  'Product_price_valid',
  'GameServer_caps_valid',
];
const TRIGGERS = [
  'WalletTransaction_immutable',
  'ShopTransaction_immutable',
  'ShopOrderEvent_immutable',
  'AuditLog_immutable',
];

const serverDir = fileURLToPath(new URL('../../', import.meta.url));
const SQLSTATE = { unique: '23505', check: '23514', fk: '23503', restrict: '23001' };

afterAll(async () => {
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

describe('catalog: raw objects exist by name (§3.2.3)', () => {
  it('has the 6 partial unique indexes and 3 partial indexes', async () => {
    const rows = await testPrisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    for (const name of PARTIAL_UNIQUE) {
      const row = rows.find((r) => r.indexname === name);
      expect(row?.indexdef, `missing partial unique ${name}`).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
    }
    for (const name of PARTIAL_INDEX) {
      const row = rows.find((r) => r.indexname === name);
      expect(row?.indexdef, `missing partial index ${name}`).toMatch(/^CREATE INDEX .* WHERE /);
    }
    const partial = rows.filter((r) => / WHERE /.test(r.indexdef)).map((r) => r.indexname).sort();
    expect(partial).toEqual([...PARTIAL_UNIQUE, ...PARTIAL_INDEX].sort());
  });

  it('has every CHECK constraint from §3.2.3 and no others', async () => {
    const rows = await testPrisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    expect(rows.map((r) => r.conname).sort()).toEqual([...CHECKS].sort());
  });

  it('has the 4 append-only triggers by name', async () => {
    const rows = await testPrisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    expect(rows.map((r) => r.tgname).sort()).toEqual([...TRIGGERS].sort());
  });
});

describe('User', () => {
  it('accepts a GUEST with no credentials (baseline)', async () => {
    await expect(seedGuest()).resolves.toMatchObject({ kind: 'GUEST' });
  });

  it('accepts many GUEST rows with null username', async () => {
    await seedGuest();
    await expect(seedGuest()).resolves.toMatchObject({ username: null });
  });

  it('rejects a GUEST that has a username', async () => {
    await expectDbError(
      () => testPrisma.user.create({ data: { kind: 'GUEST', username: 'guest_x' } }),
      { sqlstate: SQLSTATE.check, text: 'User_kind_credentials' },
    );
  });

  it('rejects a GUEST that has a passwordHash', async () => {
    await expectDbError(
      () => testPrisma.user.create({ data: { kind: 'GUEST', passwordHash: 'h' } }),
      { sqlstate: SQLSTATE.check, text: 'User_kind_credentials' },
    );
  });

  it('rejects a REGISTERED without username', async () => {
    await expectDbError(
      () => testPrisma.user.create({ data: { kind: 'REGISTERED', passwordHash: 'h' } }),
      { sqlstate: SQLSTATE.check, text: 'User_kind_credentials' },
    );
  });

  it('rejects a REGISTERED without passwordHash', async () => {
    await expectDbError(
      () => testPrisma.user.create({ data: { kind: 'REGISTERED', username: 'alice' } }),
      { sqlstate: SQLSTATE.check, text: 'User_kind_credentials' },
    );
  });

  it('rejects two users with the same username', async () => {
    await seedUser('alice');
    await expectDbError(() => seedUser('alice'), { sqlstate: SQLSTATE.unique, text: 'User_username_key' });
  });
});

describe('Wallet and ShopTreasury', () => {
  it('accepts a wallet with balance 100 and held 100 (baseline)', async () => {
    const user = await seedUser();
    await expect(
      testPrisma.wallet.create({ data: { userId: user.id, balance: 100n, heldBalance: 100n } }),
    ).resolves.toMatchObject({ balance: 100n });
  });

  it('rejects a negative balance', async () => {
    // A negative balance with held >= 0 also breaks Wallet_held_valid. PostgreSQL checks
    // CHECK constraints in name order, so Wallet_balance_nonneg is the one reported.
    const user = await seedUser();
    await expectDbError(
      () => testPrisma.wallet.create({ data: { userId: user.id, balance: -1n, heldBalance: 0n } }),
      { sqlstate: SQLSTATE.check, text: 'Wallet_balance_nonneg' },
    );
  });

  it('rejects held greater than balance', async () => {
    const user = await seedUser();
    await expectDbError(
      () => testPrisma.wallet.create({ data: { userId: user.id, balance: 100n, heldBalance: 150n } }),
      { sqlstate: SQLSTATE.check, text: 'Wallet_held_valid' },
    );
  });

  it('rejects a negative treasury balance', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    const shop = await seedDefaultShop(server.id, plot.id, 1);
    await expectDbError(
      () => testPrisma.shopTreasury.create({ data: { shopId: shop.id, balance: -1n } }),
      { sqlstate: SQLSTATE.check, text: 'ShopTreasury_balance_nonneg' },
    );
  });
});

describe('ServerSession and ShopEmployee and EmployeeApplication', () => {
  it('rejects two ACTIVE sessions for one user', async () => {
    const server = await seedServer();
    const user = await seedUser();
    await testPrisma.serverSession.create({ data: { userId: user.id, serverId: server.id, status: 'ACTIVE' } });
    await expectDbError(
      () => testPrisma.serverSession.create({ data: { userId: user.id, serverId: server.id, status: 'ACTIVE' } }),
      { sqlstate: SQLSTATE.unique, text: 'ServerSession_one_active_per_user' },
    );
  });

  it('rejects two ACTIVE employments for one user', async () => {
    const server = await seedServer();
    const plotA = await seedPlot(server.id, 'D1');
    const plotB = await seedPlot(server.id, 'D2');
    const shopA = await seedDefaultShop(server.id, plotA.id, 1);
    const shopB = await seedDefaultShop(server.id, plotB.id, 2);
    const worker = await seedUser();
    const employ = (shopId: string) =>
      testPrisma.shopEmployee.create({ data: { userId: worker.id, shopId, serverId: server.id, status: 'ACTIVE' } });
    await employ(shopA.id);
    await expectDbError(() => employ(shopB.id), {
      sqlstate: SQLSTATE.unique,
      text: 'ShopEmployee_one_active_per_user',
    });
  });

  it('accepts a second employment when the first has ended', async () => {
    const server = await seedServer();
    const plotA = await seedPlot(server.id, 'D1');
    const plotB = await seedPlot(server.id, 'D2');
    const shopA = await seedDefaultShop(server.id, plotA.id, 1);
    const shopB = await seedDefaultShop(server.id, plotB.id, 2);
    const worker = await seedUser();
    await testPrisma.shopEmployee.create({
      data: { userId: worker.id, shopId: shopA.id, serverId: server.id, status: 'RESIGNED' },
    });
    await expect(
      testPrisma.shopEmployee.create({
        data: { userId: worker.id, shopId: shopB.id, serverId: server.id, status: 'ACTIVE' },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('rejects two PENDING applications from one user to one shop', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    const shop = await seedDefaultShop(server.id, plot.id, 1);
    const applicant = await seedUser();
    const apply = () =>
      testPrisma.employeeApplication.create({
        data: { userId: applicant.id, shopId: shop.id, serverId: server.id, status: 'PENDING' },
      });
    await apply();
    await expectDbError(apply, { sqlstate: SQLSTATE.unique, text: 'EmployeeApplication_one_pending' });
  });
});

describe('Shop', () => {
  it('rejects two live shops on one plot', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'P1');
    const ownerA = await seedUser();
    const ownerB = await seedUser();
    await seedPlayerShop(server.id, plot.id, ownerA.id);
    await expectDbError(() => seedPlayerShop(server.id, plot.id, ownerB.id), {
      sqlstate: SQLSTATE.unique,
      text: 'Shop_one_live_per_plot',
    });
  });

  it('accepts a new shop on a plot whose old shop is CLOSED', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'P1');
    const ownerA = await seedUser();
    const ownerB = await seedUser();
    await testPrisma.shop.create({
      data: { serverId: server.id, plotId: plot.id, type: 'PLAYER_OWNED', ownerId: ownerA.id, name: 'Old', status: 'CLOSED' },
    });
    await expect(seedPlayerShop(server.id, plot.id, ownerB.id)).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('rejects two live shops for one owner', async () => {
    const server = await seedServer();
    const plotA = await seedPlot(server.id, 'P1');
    const plotB = await seedPlot(server.id, 'P2');
    const owner = await seedUser();
    await seedPlayerShop(server.id, plotA.id, owner.id);
    await expectDbError(() => seedPlayerShop(server.id, plotB.id, owner.id), {
      sqlstate: SQLSTATE.unique,
      text: 'Shop_one_live_per_owner',
    });
  });

  it('rejects two DEFAULT shops in one default slot on one server', async () => {
    const server = await seedServer();
    const plotA = await seedPlot(server.id, 'D1');
    const plotB = await seedPlot(server.id, 'D2');
    await seedDefaultShop(server.id, plotA.id, 1);
    await expectDbError(() => seedDefaultShop(server.id, plotB.id, 1), {
      sqlstate: SQLSTATE.unique,
      text: 'Shop_default_slot_per_server',
    });
  });

  it('rejects defaultSlot 4', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    await expectDbError(() => seedDefaultShop(server.id, plot.id, 4), {
      sqlstate: SQLSTATE.check,
      text: 'Shop_type_owner_slot',
    });
  });

  it('rejects a DEFAULT shop that has an owner', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    const owner = await seedUser();
    await expectDbError(
      () =>
        testPrisma.shop.create({
          data: { serverId: server.id, plotId: plot.id, type: 'DEFAULT', defaultSlot: 1, ownerId: owner.id, name: 'X' },
        }),
      { sqlstate: SQLSTATE.check, text: 'Shop_type_owner_slot' },
    );
  });

  it('rejects a PLAYER_OWNED shop without an owner', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'P1');
    await expectDbError(
      () => testPrisma.shop.create({ data: { serverId: server.id, plotId: plot.id, type: 'PLAYER_OWNED', name: 'X' } }),
      { sqlstate: SQLSTATE.check, text: 'Shop_type_owner_slot' },
    );
  });
});

describe('ShopOrder', () => {
  // Valid in every column except the one each test breaks.
  async function fixture() {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    const shop = await seedDefaultShop(server.id, plot.id, 1);
    const customer = await seedUser();
    const handler = await seedUser();
    return { server, shop, customer, handler };
  }
  const order = (
    f: { server: { id: string }; shop: { id: string }; customer: { id: string } },
    over: Record<string, unknown> = {},
  ) => ({
    serverId: f.server.id,
    shopId: f.shop.id,
    customerId: f.customer.id,
    status: 'PENDING' as const,
    totalAmount: 100n,
    supplyCostTotal: 60n,
    commissionBpsSnapshot: 1000,
    expiresAt: futureDate(),
    ...over,
  });

  it('accepts a valid PENDING order on a DEFAULT shop (baseline)', async () => {
    const f = await fixture();
    await expect(testPrisma.shopOrder.create({ data: order(f) })).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects a customer buying from their own shop', async () => {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'P1');
    const owner = await seedUser();
    const shop = await seedPlayerShop(server.id, plot.id, owner.id);
    await expectDbError(
      () =>
        testPrisma.shopOrder.create({
          data: { ...order({ server, shop, customer: owner }), ownerIdSnapshot: owner.id },
        }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_no_self_purchase' },
    );
  });

  it('rejects a handler who is also the customer', async () => {
    const f = await fixture();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: { ...order(f), handlerId: f.customer.id } }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_no_self_handle' },
    );
  });

  it('rejects ACCEPTED without a handler', async () => {
    const f = await fixture();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: order(f, { status: 'ACCEPTED' }) }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_handler_required' },
    );
  });

  it('rejects totalAmount of 0', async () => {
    const f = await fixture();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: order(f, { totalAmount: 0n }) }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_amounts_valid' },
    );
  });

  it('rejects commissionBpsSnapshot above 10000', async () => {
    const f = await fixture();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: order(f, { commissionBpsSnapshot: 10001 }) }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_amounts_valid' },
    );
  });

  it('accepts a COMPLETED order whose settlement adds up', async () => {
    const f = await fixture();
    await expect(
      testPrisma.shopOrder.create({
        data: {
          ...order(f, { status: 'COMPLETED' }),
          handlerId: f.handler.id,
          commissionAmount: 10n,
          profitAmount: 30n,
        },
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('rejects COMPLETED without settlement amounts', async () => {
    const f = await fixture();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: { ...order(f, { status: 'COMPLETED' }), handlerId: f.handler.id } }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_settlement_valid' },
    );
  });

  it('rejects settlement that does not sum to totalAmount', async () => {
    const f = await fixture();
    await expectDbError(
      () =>
        testPrisma.shopOrder.create({
          data: {
            ...order(f, { status: 'COMPLETED' }),
            handlerId: f.handler.id,
            commissionAmount: 10n,
            profitAmount: 25n,
          },
        }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrder_settlement_valid' },
    );
  });

  it('rejects an order whose shop is on another server (composite FK)', async () => {
    const f = await fixture();
    const otherServer = await seedServer();
    await expectDbError(
      () => testPrisma.shopOrder.create({ data: order(f, { serverId: otherServer.id }) }),
      { sqlstate: SQLSTATE.fk, text: 'ShopOrder_shopId_serverId_fkey' },
    );
  });
});

describe('ShopOrderItem and Product and GameServer', () => {
  async function orderFixture() {
    const server = await seedServer();
    const plot = await seedPlot(server.id, 'D1');
    const shop = await seedDefaultShop(server.id, plot.id, 1);
    const customer = await seedUser();
    const product = await seedProduct();
    const placed = await testPrisma.shopOrder.create({
      data: {
        serverId: server.id,
        shopId: shop.id,
        customerId: customer.id,
        totalAmount: 100n,
        supplyCostTotal: 60n,
        commissionBpsSnapshot: 1000,
        expiresAt: futureDate(),
      },
    });
    return { placed, product };
  }
  const item = (orderId: string, productId: string, over: Record<string, unknown> = {}) => ({
    orderId,
    productId,
    productNameSnapshot: 'Tra da',
    unitPriceSnapshot: 30n,
    unitSupplyCostSnapshot: 10n,
    quantity: 2,
    ...over,
  });

  it('accepts a valid order item (baseline)', async () => {
    const { placed, product } = await orderFixture();
    await expect(testPrisma.shopOrderItem.create({ data: item(placed.id, product.id) })).resolves.toMatchObject({
      quantity: 2,
    });
  });

  it('rejects quantity 0', async () => {
    const { placed, product } = await orderFixture();
    await expectDbError(
      () => testPrisma.shopOrderItem.create({ data: item(placed.id, product.id, { quantity: 0 }) }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrderItem_valid' },
    );
  });

  it('rejects quantity above 10', async () => {
    const { placed, product } = await orderFixture();
    await expectDbError(
      () => testPrisma.shopOrderItem.create({ data: item(placed.id, product.id, { quantity: 11 }) }),
      { sqlstate: SQLSTATE.check, text: 'ShopOrderItem_valid' },
    );
  });

  it('rejects a product with minPrice 0', async () => {
    await expectDbError(
      () =>
        testPrisma.product.create({
          data: { id: 'bad', name: 'Bad', supplyCost: 10n, minPrice: 0n, defaultPrice: 30n, maxPrice: 50n },
        }),
      { sqlstate: SQLSTATE.check, text: 'Product_price_valid' },
    );
  });

  it('rejects a GameServer whose softCap is above hardCap', async () => {
    await expectDbError(
      async () => {
        await worldMapId();
        return testPrisma.gameServer.create({
          data: { slug: 'bad-caps', name: 'Bad', worldMapId: 'street-01', softCap: 30, hardCap: 25 },
        });
      },
      { sqlstate: SQLSTATE.check, text: 'GameServer_caps_valid' },
    );
  });
});

describe('append-only ledgers and logs', () => {
  type Case = {
    table: string;
    create: () => Promise<{ update: () => Promise<unknown>; remove: () => Promise<unknown> }>;
  };
  const cases: Case[] = [
    {
      table: 'WalletTransaction',
      create: async () => {
        const user = await seedUser();
        const wallet = await testPrisma.wallet.create({ data: { userId: user.id, balance: 100n, heldBalance: 0n } });
        const row = await testPrisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'STARTER_GRANT',
            amountDelta: 100n,
            balanceAfter: 100n,
            heldAfter: 0n,
            idempotencyKey: randomUUID(),
            txGroupId: randomUUID(),
            refType: 'TEST',
            refId: 'ref-1',
          },
        });
        return {
          update: () => testPrisma.walletTransaction.update({ where: { id: row.id }, data: { refId: 'changed' } }),
          remove: () => testPrisma.walletTransaction.delete({ where: { id: row.id } }),
        };
      },
    },
    {
      table: 'ShopTransaction',
      create: async () => {
        const server = await seedServer();
        const plot = await seedPlot(server.id, 'D1');
        const shop = await seedDefaultShop(server.id, plot.id, 1);
        const treasury = await testPrisma.shopTreasury.create({ data: { shopId: shop.id } });
        const row = await testPrisma.shopTransaction.create({
          data: {
            treasuryId: treasury.id,
            type: 'ORDER_REVENUE',
            amountDelta: 100n,
            balanceAfter: 100n,
            idempotencyKey: randomUUID(),
            txGroupId: randomUUID(),
            refType: 'TEST',
            refId: 'ref-1',
            serverId: server.id,
          },
        });
        return {
          update: () => testPrisma.shopTransaction.update({ where: { id: row.id }, data: { refId: 'changed' } }),
          remove: () => testPrisma.shopTransaction.delete({ where: { id: row.id } }),
        };
      },
    },
    {
      table: 'ShopOrderEvent',
      create: async () => {
        const f = await orderFixtureForEvents();
        const row = await testPrisma.shopOrderEvent.create({
          data: { orderId: f.id, toStatus: 'PENDING', reason: 'created' },
        });
        return {
          update: () => testPrisma.shopOrderEvent.update({ where: { id: row.id }, data: { reason: 'changed' } }),
          remove: () => testPrisma.shopOrderEvent.delete({ where: { id: row.id } }),
        };
      },
    },
    {
      table: 'AuditLog',
      create: async () => {
        const row = await testPrisma.auditLog.create({
          data: { action: 'TEST', targetType: 'Thing', targetId: 'thing-1' },
        });
        return {
          update: () => testPrisma.auditLog.update({ where: { id: row.id }, data: { action: 'changed' } }),
          remove: () => testPrisma.auditLog.delete({ where: { id: row.id } }),
        };
      },
    },
  ];

  for (const c of cases) {
    it(`rejects UPDATE on ${c.table}`, async () => {
      const row = await c.create();
      await expectDbError(row.update, { sqlstate: SQLSTATE.restrict, text: `${c.table} is append-only` });
    });

    it(`rejects DELETE on ${c.table}`, async () => {
      const row = await c.create();
      await expectDbError(row.remove, { sqlstate: SQLSTATE.restrict, text: `${c.table} is append-only` });
    });
  }
});

describe('schema drift', () => {
  it('prisma migrate diff against the datasource exits 0', () => {
    const res = spawnSync(
      process.execPath,
      [
        './node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { cwd: serverDir, env: process.env, encoding: 'utf8' },
    );
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
  }, 120_000);
});

async function worldMapId(): Promise<string> {
  await testPrisma.worldMap.upsert({ where: { id: 'street-01' }, create: { id: 'street-01', version: 1 }, update: {} });
  return 'street-01';
}

async function orderFixtureForEvents() {
  const server = await seedServer();
  const plot = await seedPlot(server.id, 'D1');
  const shop = await seedDefaultShop(server.id, plot.id, 1);
  const customer = await seedGuest();
  return testPrisma.shopOrder.create({
    data: {
      serverId: server.id,
      shopId: shop.id,
      customerId: customer.id,
      totalAmount: 100n,
      supplyCostTotal: 60n,
      commissionBpsSnapshot: 1000,
      expiresAt: futureDate(),
    },
  });
}
