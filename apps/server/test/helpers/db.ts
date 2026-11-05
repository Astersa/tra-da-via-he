import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set; setupFiles should load .env.test');

// Real PostgreSQL on port 5433. No mocks.
export const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 5 }),
});

// TRUNCATE ... CASCADE, not DELETE: the append-only triggers block row-level DELETE.
export async function resetDb(): Promise<void> {
  const rows = await testPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) throw new Error('No tables in test DB: run `pnpm --filter @tdvh/server db:migrate:test`');
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ?? '';
}

// Collects the message and enumerable fields of the error and its causes, so the
// driver error (SQLSTATE, constraint name, trigger message) is visible.
function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur instanceof Error) {
      parts.push(cur.message, safeJson(Object.assign({}, cur)));
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(safeJson(cur));
      break;
    }
  }
  return parts.join(' | ');
}

// Asserts that `op` fails with the given PostgreSQL SQLSTATE and that the error names
// the constraint (or trigger message) that was violated. A generic rejection is not enough.
export async function expectDbError(
  op: () => Promise<unknown>,
  expected: { sqlstate: string; text: string },
): Promise<void> {
  let threw = false;
  let thrown: unknown;
  try {
    await op();
  } catch (e) {
    threw = true;
    thrown = e;
  }
  if (!threw) throw new Error(`expected ${expected.text} (SQLSTATE ${expected.sqlstate}) but the operation succeeded`);
  const text = errorText(thrown);
  const sqlstate = /"(?:originalCode|code)":"(\d{5})"/.exec(text)?.[1];
  if (sqlstate !== expected.sqlstate || !text.includes(expected.text)) {
    throw new Error(
      `expected SQLSTATE ${expected.sqlstate} naming "${expected.text}", got sqlstate=${sqlstate}: ${text}`,
    );
  }
}

let seq = 0;
const nextName = (prefix: string): string => `${prefix}${++seq}`;
export const futureDate = (): Date => new Date(Date.now() + 60_000);

export async function seedServer(slug = nextName('srv')) {
  await testPrisma.worldMap.upsert({
    where: { id: 'street-01' },
    create: { id: 'street-01', version: 1 },
    update: {},
  });
  return testPrisma.gameServer.create({ data: { slug, name: slug, worldMapId: 'street-01' } });
}

export function seedUser(username = nextName('user')) {
  return testPrisma.user.create({
    data: { kind: 'REGISTERED', username, passwordHash: 'test-hash' },
  });
}

export function seedGuest() {
  return testPrisma.user.create({ data: { kind: 'GUEST' } });
}

export function seedPlot(serverId: string, mapSlot: string) {
  return testPrisma.shopPlot.create({
    data: { serverId, mapSlot, kind: 'PURCHASABLE', openFee: 1000n },
  });
}

export function seedDefaultShop(serverId: string, plotId: string, defaultSlot: number) {
  return testPrisma.shop.create({
    data: { serverId, plotId, type: 'DEFAULT', defaultSlot, name: nextName('Quan') },
  });
}

export function seedPlayerShop(serverId: string, plotId: string, ownerId: string) {
  return testPrisma.shop.create({
    data: { serverId, plotId, type: 'PLAYER_OWNED', ownerId, name: nextName('Quan') },
  });
}

export function seedProduct(id = 'tra-da') {
  return testPrisma.product.upsert({
    where: { id },
    create: { id, name: 'Tra da', supplyCost: 10n, minPrice: 20n, defaultPrice: 30n, maxPrice: 50n },
    update: {},
  });
}
