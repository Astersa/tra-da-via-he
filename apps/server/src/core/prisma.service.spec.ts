import { describe, expect, it } from 'vitest';
import { DEFAULT_DB_POOL_MAX, readPoolMax } from './prisma.service.js';

describe('readPoolMax', () => {
  it('defaults to 5 when DB_POOL_MAX is unset', () => {
    expect(DEFAULT_DB_POOL_MAX).toBe(5);
    expect(readPoolMax({})).toBe(5);
  });

  it('parses DB_POOL_MAX=20 as 20', () => {
    expect(readPoolMax({ DB_POOL_MAX: '20' })).toBe(20);
  });

  it.each(['0', 'abc', '-1', '1.5', ' 5'])('rejects DB_POOL_MAX=%j', (raw) => {
    expect(() => readPoolMax({ DB_POOL_MAX: raw })).toThrow(/DB_POOL_MAX/);
  });
});
