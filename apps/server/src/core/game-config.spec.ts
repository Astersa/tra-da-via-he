import { describe, expect, it } from 'vitest';
import { loadGameConfig } from './game-config.js';

// Expected defaults, written out explicitly from IMPLEMENTATION-PLAN.md §3.9 (GameConfig table).
const EXPECTED_DEFAULTS = {
  guestStarterGrant: 300n,
  registerBonus: 1700n,
  dailyTopupFloor: 500n,
  shopOpenFee: 5000n,
  commissionBps: 2000,
  commissionPairDailyCap: 20,
  withdrawFeeBps: 500,
  purchasablePlots: 4,
  softCap: 15,
  hardCap: 25,
  employeeCapPerShop: 5,
  defaultShopEmployeeCap: 2,
  defaultShopResetTickSeconds: 60,
  orderTtlSeconds: 600,
  acceptTimeoutSeconds: 300,
  minPrepareSeconds: 5,
  sweepIntervalSeconds: 15,
  reconnectGraceSeconds: 30,
  maxOpenOrdersPerCustomer: 3,
  maxActiveOrdersPerHandler: 3,
  maxPendingApplications: 3,
  guestsPerIpPerDay: 10,
} as const;

const MONEY_KEYS = ['guestStarterGrant', 'registerBonus', 'dailyTopupFloor', 'shopOpenFee'] as const;

// Env name = GAME_ + SCREAMING_SNAKE_CASE of the key (IMPLEMENTATION-PLAN.md §3.9).
const envName = (key: string): string => `GAME_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;

describe('loadGameConfig', () => {
  it('returns every §3.9 default when no GAME_* env is set', () => {
    expect(loadGameConfig({})).toEqual(EXPECTED_DEFAULTS);
  });

  it('types money keys as bigint and everything else as number', () => {
    const cfg = loadGameConfig({});
    for (const key of MONEY_KEYS) expect(typeof cfg[key]).toBe('bigint');
    for (const key of Object.keys(EXPECTED_DEFAULTS)) {
      if (!(MONEY_KEYS as readonly string[]).includes(key)) expect(typeof cfg[key as keyof typeof cfg]).toBe('number');
    }
  });

  it('maps every key to GAME_<SCREAMING_SNAKE_CASE> and applies the override', () => {
    for (const key of Object.keys(EXPECTED_DEFAULTS)) {
      const isMoney = (MONEY_KEYS as readonly string[]).includes(key);
      const cfg = loadGameConfig({ [envName(key)]: '7' });
      expect(cfg[key as keyof typeof cfg]).toBe(isMoney ? 7n : 7);
    }
  });

  it('uses the documented names for a sample of keys', () => {
    expect(envName('commissionBps')).toBe('GAME_COMMISSION_BPS');
    expect(envName('shopOpenFee')).toBe('GAME_SHOP_OPEN_FEE');
    expect(envName('softCap')).toBe('GAME_SOFT_CAP');
    expect(envName('defaultShopResetTickSeconds')).toBe('GAME_DEFAULT_SHOP_RESET_TICK_SECONDS');
  });

  it('applies GAME_SOFT_CAP=20', () => {
    expect(loadGameConfig({ GAME_SOFT_CAP: '20' }).softCap).toBe(20);
  });

  it('accepts commissionBps at the 0 and 10000 bounds', () => {
    expect(loadGameConfig({ GAME_COMMISSION_BPS: '0' }).commissionBps).toBe(0);
    expect(loadGameConfig({ GAME_COMMISSION_BPS: '10000' }).commissionBps).toBe(10000);
  });

  it('rejects GAME_COMMISSION_BPS=10001', () => {
    expect(() => loadGameConfig({ GAME_COMMISSION_BPS: '10001' })).toThrow(/GAME_COMMISSION_BPS/);
  });

  it('rejects GAME_WITHDRAW_FEE_BPS above 10000', () => {
    expect(() => loadGameConfig({ GAME_WITHDRAW_FEE_BPS: '10001' })).toThrow(/GAME_WITHDRAW_FEE_BPS/);
  });

  it.each(['1.5', 'abc', '-1', '', ' 5', '1e3'])('rejects bigint money value %j', (raw) => {
    expect(() => loadGameConfig({ GAME_SHOP_OPEN_FEE: raw })).toThrow(/GAME_SHOP_OPEN_FEE/);
  });

  it('rejects money values longer than 18 digits', () => {
    expect(() => loadGameConfig({ GAME_REGISTER_BONUS: '99999999999999999999' })).toThrow(/GAME_REGISTER_BONUS/);
  });

  it('accepts money value 0', () => {
    expect(loadGameConfig({ GAME_SHOP_OPEN_FEE: '0' }).shopOpenFee).toBe(0n);
  });

  it.each(['1.5', 'abc', '-1', '', ' 5', '1e3'])('rejects integer value %j', (raw) => {
    expect(() => loadGameConfig({ GAME_SOFT_CAP: raw })).toThrow(/GAME_SOFT_CAP/);
  });

  it('rejects an integer that is not a safe integer', () => {
    expect(() => loadGameConfig({ GAME_SOFT_CAP: '9007199254740993' })).toThrow(/GAME_SOFT_CAP/);
  });
});
