// STUB: chưa cài đặt. Sẽ thay ở bước 2.
import { z } from "zod";

export const MoneySchema: z.ZodType<string> = z.string();
export const PositiveMoneySchema: z.ZodType<string> = z.string();

export function toMoney(_v: bigint): string {
  throw new Error("not implemented");
}

export function parseMoney(_s: string): bigint {
  throw new Error("not implemented");
}

export function formatXu(_s: string): string {
  throw new Error("not implemented");
}

export function bpsOf(_amount: bigint, _bps: number): bigint {
  throw new Error("not implemented");
}
