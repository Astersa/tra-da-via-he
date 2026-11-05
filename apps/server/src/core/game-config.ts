import { z } from 'zod';

// Every number that drives the economy and capacity. Source: IMPLEMENTATION-PLAN.md §3.9.
// Money is bigint; basis points and counts/seconds are integers.
export interface GameConfig {
  guestStarterGrant: bigint;
  registerBonus: bigint;
  dailyTopupFloor: bigint;
  shopOpenFee: bigint;
  commissionBps: number;
  commissionPairDailyCap: number;
  withdrawFeeBps: number;
  purchasablePlots: number;
  softCap: number;
  hardCap: number;
  employeeCapPerShop: number;
  defaultShopEmployeeCap: number;
  defaultShopResetTickSeconds: number;
  orderTtlSeconds: number;
  acceptTimeoutSeconds: number;
  minPrepareSeconds: number;
  sweepIntervalSeconds: number;
  reconnectGraceSeconds: number;
  maxOpenOrdersPerCustomer: number;
  maxActiveOrdersPerHandler: number;
  maxPendingApplications: number;
  guestsPerIpPerDay: number;
}

export const GAME_CONFIG = 'GAME_CONFIG';

// Money: non-negative integer string, at most 18 digits (same as MoneySchema in @tdvh/shared).
const moneySchema = z
  .string()
  .regex(/^\d{1,18}$/)
  .transform((s) => BigInt(s));

// Non-negative safe integer string.
const intSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((s) => Number(s))
  .pipe(z.number().int().safe());

// Basis points: integer 0..10000.
const bpsSchema = intSchema.pipe(z.number().max(10000));

type Kind = 'money' | 'int' | 'bps';

const SPEC = {
  guestStarterGrant: { kind: 'money', def: 300n },
  registerBonus: { kind: 'money', def: 1700n },
  dailyTopupFloor: { kind: 'money', def: 500n },
  shopOpenFee: { kind: 'money', def: 5000n },
  commissionBps: { kind: 'bps', def: 2000 },
  commissionPairDailyCap: { kind: 'int', def: 20 },
  withdrawFeeBps: { kind: 'bps', def: 500 },
  purchasablePlots: { kind: 'int', def: 4 },
  softCap: { kind: 'int', def: 15 },
  hardCap: { kind: 'int', def: 25 },
  employeeCapPerShop: { kind: 'int', def: 5 },
  defaultShopEmployeeCap: { kind: 'int', def: 2 },
  defaultShopResetTickSeconds: { kind: 'int', def: 60 },
  orderTtlSeconds: { kind: 'int', def: 600 },
  acceptTimeoutSeconds: { kind: 'int', def: 300 },
  minPrepareSeconds: { kind: 'int', def: 5 },
  sweepIntervalSeconds: { kind: 'int', def: 15 },
  reconnectGraceSeconds: { kind: 'int', def: 30 },
  maxOpenOrdersPerCustomer: { kind: 'int', def: 3 },
  maxActiveOrdersPerHandler: { kind: 'int', def: 3 },
  maxPendingApplications: { kind: 'int', def: 3 },
  guestsPerIpPerDay: { kind: 'int', def: 10 },
} satisfies Record<keyof GameConfig, { kind: Kind; def: bigint | number }>;

type Key = keyof GameConfig;

// GAME_ + SCREAMING_SNAKE_CASE of the key, e.g. commissionBps -> GAME_COMMISSION_BPS.
export function envNameFor(key: Key): string {
  return `GAME_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

const SCHEMAS: Record<Kind, z.ZodType<bigint | number>> = {
  money: moneySchema,
  int: intSchema,
  bps: bpsSchema,
};

// Reads GAME_* overrides. Unset means the §3.9 default. A set value that is malformed
// (including empty) throws, naming the env variable.
export function loadGameConfig(env: NodeJS.ProcessEnv): GameConfig {
  const out: Record<string, bigint | number> = {};
  for (const key of Object.keys(SPEC) as Key[]) {
    const { kind, def } = SPEC[key];
    const name = envNameFor(key);
    const raw = env[name];
    if (raw === undefined) {
      out[key] = def;
      continue;
    }
    const parsed = SCHEMAS[kind].safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${name} must be a ${kind === 'money' ? 'non-negative integer (max 18 digits)' : kind === 'bps' ? 'integer 0..10000' : 'non-negative safe integer'}, got "${raw}"`);
    }
    out[key] = parsed.data;
  }
  return out as unknown as GameConfig;
}
