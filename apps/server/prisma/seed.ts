import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadGameConfig, type GameConfig } from '../src/core/game-config.js';
import { readPoolMax } from '../src/core/prisma.service.js';
import { withTx } from '../src/core/tx.js';
import { PrismaClient, type Product } from '../src/generated/prisma/client.js';
import { assertProductFloors } from '../src/economy/product-floors.js';

// Catalog from IMPLEMENTATION-PLAN.md §3.9. Only these rows are written by the seed.
export const CATALOG: Product[] = [
  { id: 'tra-da', name: 'Trà đá', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
  { id: 'tra-chanh', name: 'Trà chanh', supplyCost: 30n, minPrice: 40n, defaultPrice: 150n, maxPrice: 400n },
  { id: 'huong-duong', name: 'Hạt hướng dương', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
];

const WORLD_MAP_ID = 'street-01';

// Idempotent: re-running upserts the catalog and never overwrites WorldMap.version.
// Floors are checked before any write.
export async function seed(prisma: PrismaClient, cfg: GameConfig): Promise<void> {
  assertProductFloors(CATALOG, cfg);
  await withTx(prisma, async (tx) => {
    await tx.worldMap.upsert({
      where: { id: WORLD_MAP_ID },
      create: { id: WORLD_MAP_ID, version: 1 },
      update: {},
    });
    for (const p of CATALOG) {
      await tx.product.upsert({
        where: { id: p.id },
        create: p,
        update: { name: p.name, supplyCost: p.supplyCost, minPrice: p.minPrice, defaultPrice: p.defaultPrice, maxPrice: p.maxPrice },
      });
    }
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: readPoolMax() }) });
  try {
    await seed(prisma, loadGameConfig(process.env));
    console.log(`seed ok: products=${await prisma.product.count()} worldMaps=${await prisma.worldMap.count()}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (db:seed), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
