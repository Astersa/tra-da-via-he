import { describe, it, expect } from "vitest";
import { ERROR_CODES, RETRYABLE_CODES, ok } from "../src/index.js";

// Mọi mã xuất hiện trong bảng §3.4.2 và danh sách đầy đủ §3.4.3.
const PLAN_CODES_34_2 = [
  "SERVER_NOT_FOUND", "SERVER_NOT_ACTIVE", "SERVER_FULL", "ALREADY_IN_SERVER",
  "SEAT_NOT_FOUND", "SEAT_TAKEN", "TOO_FAR", "CHAT_MUTED",
  "SHOP_NOT_FOUND", "SHOP_NOT_HIRING", "SHOP_FULL", "ALREADY_EMPLOYED", "ALREADY_APPLIED",
  "OWNER_CANNOT_APPLY", "TOO_MANY_APPLICATIONS", "APPLICATION_NOT_FOUND", "APPLICATION_NOT_PENDING",
  "APPLICANT_ALREADY_EMPLOYED", "FORBIDDEN", "SHOP_NOT_ACCEPTING", "MENU_ITEM_UNAVAILABLE",
  "INSUFFICIENT_FUNDS", "SELF_PURCHASE_FORBIDDEN", "TOO_MANY_OPEN_ORDERS", "IDEMPOTENCY_CONFLICT",
  "ORDER_NOT_FOUND", "ORDER_INVALID_STATE", "ORDER_ALREADY_TAKEN", "TOO_MANY_ACTIVE_ORDERS",
  "ORDER_NOT_HANDLER", "ORDER_TOO_EARLY", "ORDER_ACCEPT_EXPIRED",
  "SESSION_STALE", "VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL_ERROR",
];

const PLAN_CODES_34_3 = [
  "UNAUTHENTICATED", "TOKEN_EXPIRED", "INVALID_CREDENTIALS", "USERNAME_TAKEN", "ALREADY_REGISTERED", "ACCOUNT_REQUIRED", "DISPLAY_NAME_TAKEN",
  "DISPLAY_NAME_INVALID", "NOT_FOUND", "PLOT_NOT_FOUND", "PLOT_TAKEN", "PLOT_NOT_PURCHASABLE",
  "SHOP_LIMIT_REACHED", "PRICE_OUT_OF_RANGE", "TREASURY_INSUFFICIENT", "AMOUNT_INVALID",
  "NOT_EMPLOYED", "TOPUP_NOT_ELIGIBLE",
];

describe("ERROR_CODES", () => {
  it("has no duplicate codes", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it("contains every code from §3.4.2 and §3.4.3", () => {
    for (const code of [...PLAN_CODES_34_2, ...PLAN_CODES_34_3]) {
      expect(ERROR_CODES, code).toContain(code);
    }
  });

  it("has no codes beyond the plan", () => {
    const planned = new Set([...PLAN_CODES_34_2, ...PLAN_CODES_34_3]);
    for (const code of ERROR_CODES) {
      expect(planned.has(code), code).toBe(true);
    }
  });
});

describe("RETRYABLE_CODES", () => {
  it("is exactly RATE_LIMITED and INTERNAL_ERROR", () => {
    expect([...RETRYABLE_CODES].sort()).toEqual(["INTERNAL_ERROR", "RATE_LIMITED"]);
  });
});

describe("ok", () => {
  it("wraps data in a successful Ack", () => {
    expect(ok({ id: "1" })).toEqual({ ok: true, data: { id: "1" } });
  });
});
