import { describe, it, expect } from "vitest";
import {
  MoneySchema,
  PositiveMoneySchema,
  toMoney,
  parseMoney,
  formatXu,
  bpsOf,
} from "../src/index.js";

describe("MoneySchema", () => {
  it("accepts decimal integer strings up to 18 digits, with optional minus", () => {
    for (const ok of ["0", "1500", "-20", "999999999999999999", "-999999999999999999"]) {
      expect(MoneySchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejects non-integer, non-decimal, and malformed strings", () => {
    for (const bad of ["1.5", "", "abc", "1e3", " 1", "+5", "--1", "1234567890123456789", "-"]) {
      expect(MoneySchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rejects non-string values", () => {
    expect(MoneySchema.safeParse(1500).success).toBe(false);
    expect(MoneySchema.safeParse(1500n).success).toBe(false);
  });
});

describe("PositiveMoneySchema", () => {
  it("accepts positive decimal strings without leading zero", () => {
    for (const ok of ["1", "1500", "999999999999999999"]) {
      expect(PositiveMoneySchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejects zero, negatives, leading zeros, decimals and garbage", () => {
    for (const bad of ["0", "-1", "01", "1.5", "", "abc", "1234567890123456789"]) {
      expect(PositiveMoneySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("toMoney / parseMoney", () => {
  it("toMoney converts bigint to decimal string", () => {
    expect(toMoney(1500n)).toBe("1500");
    expect(toMoney(-20n)).toBe("-20");
    expect(toMoney(0n)).toBe("0");
  });

  it("parseMoney converts decimal string to bigint", () => {
    expect(parseMoney("1500")).toBe(1500n);
    expect(parseMoney("-20")).toBe(-20n);
  });

  it("parseMoney keeps values beyond Number.MAX_SAFE_INTEGER exact", () => {
    expect(parseMoney("9007199254740993")).toBe(9007199254740993n);
    expect(toMoney(9007199254740993n)).toBe("9007199254740993");
  });

  it("parseMoney throws RangeError on malformed input", () => {
    for (const bad of ["1.5", "abc", "", " 1", "1e3"]) {
      expect(() => parseMoney(bad), bad).toThrow(RangeError);
    }
  });
});

describe("formatXu", () => {
  it("groups thousands with dots and appends Xu", () => {
    expect(formatXu("1500")).toBe("1.500 Xu");
    expect(formatXu("1000000")).toBe("1.000.000 Xu");
    expect(formatXu("999")).toBe("999 Xu");
    expect(formatXu("0")).toBe("0 Xu");
  });

  it("handles negative amounts", () => {
    expect(formatXu("-20")).toBe("-20 Xu");
    expect(formatXu("-1500")).toBe("-1.500 Xu");
  });

  it("is exact for values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatXu("9007199254740993")).toBe("9.007.199.254.740.993 Xu");
  });

  it("throws RangeError on malformed input", () => {
    expect(() => formatXu("1.5")).toThrow(RangeError);
    expect(() => formatXu("abc")).toThrow(RangeError);
  });
});

describe("bpsOf", () => {
  it("matches the brief example: 20% of 100 Xu is 20 Xu", () => {
    expect(bpsOf(100n, 2000)).toBe(20n);
  });

  it("rounds down (floor)", () => {
    expect(bpsOf(99n, 2000)).toBe(19n);
    expect(bpsOf(1n, 1)).toBe(0n);
  });

  it("stays exact for balances beyond Number.MAX_SAFE_INTEGER", () => {
    expect(bpsOf(9007199254740993n, 10000)).toBe(9007199254740993n);
    expect(bpsOf(9007199254740993n, 1)).toBe(900719925474n);
  });

  it("floors toward negative infinity for negative amounts", () => {
    expect(bpsOf(-99n, 2000)).toBe(-20n);
  });

  it("returns 0 for bps 0 or zero amount, and the full amount for bps 10000", () => {
    expect(bpsOf(100n, 0)).toBe(0n);
    expect(bpsOf(0n, 500)).toBe(0n);
    expect(bpsOf(100n, 10000)).toBe(100n);
  });

  it("throws RangeError when bps is not an integer in 0..10000", () => {
    expect(() => bpsOf(100n, 1.5)).toThrow(RangeError);
    expect(() => bpsOf(100n, -1)).toThrow(RangeError);
    expect(() => bpsOf(100n, 10001)).toThrow(RangeError);
  });
});
