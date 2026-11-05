import { z } from "zod";

// Tiền là chuỗi thập phân nguyên (§3.3). Không dùng Number cho số tiền.
const MONEY_RE = /^-?\d{1,18}$/;
const POSITIVE_MONEY_RE = /^[1-9]\d{0,17}$/;

export const MoneySchema: z.ZodType<string> = z.string().regex(MONEY_RE);
export const PositiveMoneySchema: z.ZodType<string> = z
  .string()
  .regex(POSITIVE_MONEY_RE);

export function toMoney(v: bigint): string {
  return v.toString();
}

export function parseMoney(s: string): bigint {
  if (typeof s !== "string" || !MONEY_RE.test(s)) {
    throw new RangeError(`invalid money string: ${String(s)}`);
  }
  return BigInt(s);
}

export function formatXu(s: string): string {
  const value = parseMoney(s);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped} Xu`;
}

// Floor (làm tròn xuống, kể cả số âm). bps nguyên trong 0..10000.
export function bpsOf(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError(`bps must be an integer in 0..10000: ${bps}`);
  }
  const numerator = amount * BigInt(bps);
  const denominator = 10000n;
  let quotient = numerator / denominator;
  if (numerator % denominator !== 0n && numerator < 0n) {
    quotient -= 1n;
  }
  return quotient;
}
