import { describe, expect, it } from 'vitest';
import { loadGameConfig } from '../core/game-config.js';
import type { Product } from '../generated/prisma/client.js';
import { assertProductFloors } from './product-floors.js';

// Catalog from IMPLEMENTATION-PLAN.md §3.9.
const CATALOG: Product[] = [
  { id: 'tra-da', name: 'Trà đá', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
  { id: 'tra-chanh', name: 'Trà chanh', supplyCost: 30n, minPrice: 40n, defaultPrice: 150n, maxPrice: 400n },
  { id: 'huong-duong', name: 'Hạt hướng dương', supplyCost: 20n, minPrice: 30n, defaultPrice: 100n, maxPrice: 300n },
];

const product = (over: Partial<Product>): Product => ({
  id: 'p',
  name: 'p',
  supplyCost: 20n,
  minPrice: 25n,
  defaultPrice: 100n,
  maxPrice: 300n,
  ...over,
});

describe('assertProductFloors', () => {
  it('accepts the §3.9 catalog with default config', () => {
    expect(() => assertProductFloors(CATALOG, loadGameConfig({}))).not.toThrow();
  });

  it('throws when commissionBps=9000 makes minPrice too low', () => {
    // ceil(20 / (1 - 0.9)) = 200 > minPrice 30
    const cfg = loadGameConfig({ GAME_COMMISSION_BPS: '9000' });
    expect(() => assertProductFloors(CATALOG, cfg)).toThrow(/tra-da/);
  });

  it('accepts minPrice exactly at the ceil bound and rejects one below', () => {
    // supply 20, bps 2000: ceil(20 / 0.8) = 25
    const cfg = loadGameConfig({});
    expect(() => assertProductFloors([product({ minPrice: 25n })], cfg)).not.toThrow();
    expect(() => assertProductFloors([product({ minPrice: 24n })], cfg)).toThrow(/\bp\b/);
  });

  it('rounds the bound up, not down', () => {
    // supply 30, bps 2000: 30 / 0.8 = 37.5 -> 38
    const cfg = loadGameConfig({});
    expect(() => assertProductFloors([product({ supplyCost: 30n, minPrice: 37n })], cfg)).toThrow();
    expect(() => assertProductFloors([product({ supplyCost: 30n, minPrice: 38n })], cfg)).not.toThrow();
  });

  it('throws for any product with positive supply when commissionBps=10000', () => {
    const cfg = loadGameConfig({ GAME_COMMISSION_BPS: '10000' });
    expect(() => assertProductFloors([product({ supplyCost: 1n, minPrice: 1000000n })], cfg)).toThrow();
  });

  it('accepts an empty product list', () => {
    expect(() => assertProductFloors([], loadGameConfig({}))).not.toThrow();
  });
});
