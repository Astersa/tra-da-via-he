import type { GameConfig } from '../core/game-config.js';
import type { Product } from '../generated/prisma/client.js';

// IMPLEMENTATION-PLAN.md §3.6.5: minPrice >= ceil(supplyCost / (1 - commissionBps/10000)).
// Stated in integers: ceil(supplyCost * 10000 / (10000 - commissionBps)).
// Throws (startup or seed fails) if any product breaks the floor.
export function assertProductFloors(products: Product[], cfg: GameConfig): void {
  const denom = BigInt(10000 - cfg.commissionBps);
  for (const p of products) {
    let floor: bigint;
    if (p.supplyCost === 0n) {
      floor = 0n;
    } else if (denom <= 0n) {
      throw new Error(`product ${p.id}: commissionBps=${cfg.commissionBps} leaves no room for positive supplyCost`);
    } else {
      const num = p.supplyCost * 10000n;
      floor = (num + denom - 1n) / denom;
    }
    if (p.minPrice < floor) {
      throw new Error(`product ${p.id}: minPrice ${p.minPrice} is below floor ${floor} for commissionBps=${cfg.commissionBps}`);
    }
  }
}
