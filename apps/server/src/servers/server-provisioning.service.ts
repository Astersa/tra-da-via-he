import { Inject, Injectable } from '@nestjs/common';
import { GAME_CONFIG, type GameConfig } from '../core/game-config.js';
import { PrismaService } from '../core/prisma.service.js';
import { withTx, type Tx } from '../core/tx.js';
import type { GameServer, PrismaClient } from '../generated/prisma/client.js';

// IMPLEMENTATION-PLAN.md §3.5.1, §3.8, §3.9. Only this service creates DEFAULT shops (M1-E2-T1).
const WORLD_MAP_ID = 'street-01';
const DEFAULT_SLOTS = [1, 2, 3] as const;
const DEFAULT_SHOP_NAMES = ['Quán Cô Ba', 'Trà Đá Góc Phố', 'Quán Ông Tư'] as const;
const CATALOG_PRODUCT_IDS = ['tra-da', 'tra-chanh', 'huong-duong'] as const;

export interface ProvisionInput {
  slug: string;
  name: string;
}

@Injectable()
export class ServerProvisioningService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaClient,
    @Inject(GAME_CONFIG) private readonly config: GameConfig,
  ) {}

  // One transaction: any failure rolls back the server and everything under it.
  // The server stays PROVISIONING until the last step, so it is never seen half-built.
  provision({ slug, name }: ProvisionInput): Promise<GameServer> {
    return withTx(this.prisma, async (tx) => {
      const map = await tx.worldMap.findUnique({ where: { id: WORLD_MAP_ID } });
      if (!map) throw new Error(`WorldMap "${WORLD_MAP_ID}" is missing: run db:seed first`);

      const server = await tx.gameServer.create({
        data: {
          slug,
          name,
          worldMapId: WORLD_MAP_ID,
          status: 'PROVISIONING',
          softCap: this.config.softCap,
          hardCap: this.config.hardCap,
        },
      });

      const defaultPlots = [];
      for (const slot of DEFAULT_SLOTS) {
        defaultPlots.push(
          await tx.shopPlot.create({
            data: { serverId: server.id, mapSlot: `D${slot}`, kind: 'RESERVED_DEFAULT', openFee: 0n },
          }),
        );
      }
      for (let i = 1; i <= this.config.purchasablePlots; i++) {
        await tx.shopPlot.create({
          data: { serverId: server.id, mapSlot: `P${i}`, kind: 'PURCHASABLE', openFee: this.config.shopOpenFee },
        });
      }

      const shops = [];
      for (const slot of DEFAULT_SLOTS) {
        shops.push(
          await tx.shop.create({
            data: {
              serverId: server.id,
              plotId: defaultPlots[slot - 1].id,
              type: 'DEFAULT',
              defaultSlot: slot,
              name: DEFAULT_SHOP_NAMES[slot - 1],
              treasury: { create: { balance: 0n } },
            },
          }),
        );
      }

      await addMenus(tx, shops.map((s) => s.id));

      return tx.gameServer.update({ where: { id: server.id }, data: { status: 'ACTIVE' } });
    });
  }
}

// Menu prices come from the Product table. A missing catalog row throws, which rolls back the whole server.
async function addMenus(tx: Tx, shopIds: string[]): Promise<void> {
  const products = await tx.product.findMany({ where: { id: { in: [...CATALOG_PRODUCT_IDS] } } });
  const found = new Set(products.map((p) => p.id));
  const missing = CATALOG_PRODUCT_IDS.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Product catalog is missing ${missing.join(', ')}: run db:seed first`);
  }
  await tx.shopMenu.createMany({
    data: shopIds.flatMap((shopId) =>
      products.map((p) => ({ shopId, productId: p.id, price: p.defaultPrice })),
    ),
  });
}
