import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as rest from "../src/rest.js";
import * as events from "../src/events.js";
import { displayNameKey } from "../src/rest.js";

const NO_BODY = "no body";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

// Đối chiếu với bảng §3.3 (IMPLEMENTATION-PLAN.md dòng 690-745). Mỗi dòng: [method path, Req, Res].
// "no body" = không có body/query để validate (hoặc chỉ dùng cookie/path param), hoặc response không có body.
const ROWS: [string, string, string][] = [
  ["POST /auth/register", "RegisterReqSchema", "RegisterResSchema"],
  ["POST /auth/login", "LoginReqSchema", "LoginResSchema"],
  ["POST /auth/refresh", NO_BODY, "RefreshResSchema"],
  ["POST /auth/logout", NO_BODY, NO_BODY],
  ["GET /me", NO_BODY, "MeResSchema"],
  ["PATCH /me/profile", "PatchProfileReqSchema", "PatchProfileResSchema"],
  ["GET /me/wallet", NO_BODY, "GetWalletResSchema"],
  ["GET /me/wallet/transactions", "ListWalletTransactionsReqSchema", "ListWalletTransactionsResSchema"],
  ["POST /me/wallet/daily-topup", NO_BODY, "DailyTopupResSchema"],
  ["GET /me/employment", NO_BODY, "GetEmploymentResSchema"],
  ["POST /me/employment/resign", NO_BODY, "ResignEmploymentResSchema"],
  ["GET /me/applications", NO_BODY, "ListMyApplicationsResSchema"],
  ["POST /me/applications/:id/withdraw", NO_BODY, "WithdrawApplicationResSchema"],
  ["GET /me/orders", "ListMyOrdersReqSchema", "ListMyOrdersResSchema"],
  ["GET /servers", NO_BODY, "ListServersResSchema"],
  ["POST /servers/quick-join", NO_BODY, "QuickJoinResSchema"],
  ["GET /servers/:serverId/shops", NO_BODY, "ListShopsResSchema"],
  ["GET /servers/:serverId/shops/:shopId", NO_BODY, "GetShopResSchema"],
  ["GET /servers/:serverId/plots", NO_BODY, "ListPlotsResSchema"],
  ["POST /servers/:serverId/plots/:plotId/purchase", "PurchasePlotReqSchema", "PurchasePlotResSchema"],
  ["PATCH /servers/:serverId/shops/:shopId", "PatchShopReqSchema", "PatchShopResSchema"],
  ["PUT /servers/:serverId/shops/:shopId/menu/:productId", "PutMenuItemReqSchema", "PutMenuItemResSchema"],
  ["GET /servers/:serverId/shops/:shopId/orders", "ListShopOrdersReqSchema", "ListShopOrdersResSchema"],
  ["GET /servers/:serverId/shops/:shopId/applications", "ListShopApplicationsReqSchema", "ListShopApplicationsResSchema"],
  ["GET /servers/:serverId/shops/:shopId/employees", NO_BODY, "ListShopEmployeesResSchema"],
  ["POST /servers/:serverId/shops/:shopId/employees/:employeeId/terminate", "TerminateEmployeeReqSchema", "TerminateEmployeeResSchema"],
  ["GET /servers/:serverId/shops/:shopId/treasury", NO_BODY, "GetTreasuryResSchema"],
  ["GET /servers/:serverId/shops/:shopId/treasury/transactions", "ListTreasuryTransactionsReqSchema", "ListTreasuryTransactionsResSchema"],
  ["POST /servers/:serverId/shops/:shopId/treasury/withdraw", "WithdrawTreasuryReqSchema", "WithdrawTreasuryResSchema"],
  ["POST /servers/:serverId/chat/reports", "CreateChatReportReqSchema", NO_BODY],
  ["POST /admin/servers", "CreateServerReqSchema", "CreateServerResSchema"],
  ["POST /admin/users/:id/mute", "MuteUserReqSchema", NO_BODY],
  ["POST /admin/users/:id/ban", "BanUserReqSchema", NO_BODY],
  ["GET /admin/reports", "ListReportsReqSchema", "ListReportsResSchema"],
  ["POST /admin/reports/:id/resolve", NO_BODY, NO_BODY],
  ["POST /admin/employees/:employeeId/terminate", "AdminTerminateEmployeeReqSchema", "AdminTerminateEmployeeResSchema"],
  ["GET /admin/economy/reconcile", NO_BODY, "ReconcileResSchema"],
  ["GET /health", NO_BODY, "HealthResSchema"],
  ["GET /metrics", NO_BODY, NO_BODY],
];

const exportsOf = rest as Record<string, unknown>;

describe("bảng §3.3 đối chiếu schema", () => {
  it("có đúng 39 dòng endpoint", () => {
    expect(ROWS.length).toBe(39);
  });

  it("mọi schema được tham chiếu trong bảng tồn tại và là zod schema", () => {
    const names = new Set<string>();
    for (const [, req, res] of ROWS) {
      for (const n of [req, res]) if (n !== NO_BODY) names.add(n);
    }
    for (const n of names) {
      expect(exportsOf[n], n).toBeInstanceOf(z.ZodType);
    }
    // Có 39 dòng, mỗi dòng ghi đủ 2 cột Req/Res.
    expect(ROWS.every(([, req, res]) => req && res)).toBe(true);
  });

  it("request có body/query dùng .strict(): từ chối userId", () => {
    const withUserId = (s: z.ZodType) => s.safeParse({ userId: UUID }).success;
    expect(withUserId(rest.CreateChatReportReqSchema)).toBe(false);
    expect(withUserId(rest.PurchasePlotReqSchema)).toBe(false);
    expect(withUserId(rest.MuteUserReqSchema)).toBe(false);
    expect(withUserId(rest.PatchProfileReqSchema)).toBe(false);
    expect(withUserId(rest.ListWalletTransactionsReqSchema)).toBe(false);
  });
});

describe("tiền và giới hạn số", () => {
  it("PUT menu từ chối price \"0\", nhận price dương", () => {
    const base = { isActive: true };
    expect(rest.PutMenuItemReqSchema.safeParse({ ...base, price: "0" }).success).toBe(false);
    expect(rest.PutMenuItemReqSchema.safeParse({ ...base, price: "1" }).success).toBe(true);
  });

  it("withdraw từ chối amount \"0\", nhận amount dương", () => {
    const base = { clientOpId: UUID };
    expect(rest.WithdrawTreasuryReqSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(rest.WithdrawTreasuryReqSchema.safeParse({ ...base, amount: "500" }).success).toBe(true);
  });

  it("response tiền không nhận number", () => {
    expect(rest.GetWalletResSchema.safeParse({
      balance: 10, held: "0", available: "0", version: 1, dailyTopupFloor: "0",
    }).success).toBe(false);
  });

  it("GET /me/wallet trả dailyTopupFloor là chuỗi tiền", () => {
    expect(rest.GetWalletResSchema.safeParse({
      balance: "0", held: "0", available: "0", version: 1, dailyTopupFloor: "100",
    }).success).toBe(true);
  });

  it("WalletTxView và ShopTxView từ chối idempotencyKey", () => {
    const wallet = {
      id: "1", type: "DAILY_TOPUP", amountDelta: "1", heldDelta: "0", balanceAfter: "1",
      heldAfter: "0", refType: "x", refId: "y", createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(rest.WalletTxViewSchema.safeParse(wallet).success).toBe(true);
    expect(rest.WalletTxViewSchema.safeParse({ ...wallet, idempotencyKey: "k" }).success).toBe(false);

    const shop = {
      id: "1", type: "ORDER_REVENUE", amountDelta: "1", balanceAfter: "1", refType: "x",
      refId: "y", createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(rest.ShopTxViewSchema.safeParse(shop).success).toBe(true);
    expect(rest.ShopTxViewSchema.safeParse({ ...shop, idempotencyKey: "k" }).success).toBe(false);
  });

  it("ShopDetail mở rộng ShopSummary và vẫn strict", () => {
    const summary = {
      id: UUID, name: "Quán", type: "PLAYER_OWNED", mapSlot: "A1", status: "OPEN",
      isHiring: false, acceptingOrders: true, onlineStaff: 0,
    };
    const detail = {
      ...summary, ownerId: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z", menu: [],
    };
    expect(rest.ShopDetailSchema.safeParse(detail).success).toBe(true);
    expect(rest.ShopDetailSchema.safeParse({ ...detail, extra: 1 }).success).toBe(false);
  });

  it("UserView chỉ có ở rest.ts, không xuất hiện trong events.ts", () => {
    expect(exportsOf.UserViewSchema).toBeInstanceOf(z.ZodType);
    expect((events as Record<string, unknown>).UserViewSchema).toBeUndefined();
  });
});

describe("displayNameKey", () => {
  it("\"Trà Đá  \" → trada", () => {
    expect(displayNameKey("Trà Đá  ")).toBe("trada");
  });

  it("hai tên chỉ khác dấu cho cùng key", () => {
    expect(displayNameKey("Trà Đá")).toBe(displayNameKey("Tra Da"));
    expect(displayNameKey("Đức")).toBe(displayNameKey("duc"));
  });

  it("chuẩn hóa NFC và NFD như nhau", () => {
    const nfc = "Trà Đá".normalize("NFC");
    const nfd = "Trà Đá".normalize("NFD");
    expect(displayNameKey(nfc)).toBe(displayNameKey(nfd));
  });
});

describe("email", () => {
  it("chuẩn hóa lowercase", () => {
    expect(rest.EmailSchema.parse("  Ab.Cd@Example.COM ")).toBe("ab.cd@example.com");
  });
});

describe("password 8..72", () => {
  const pw = (n: number) => "a".repeat(n);
  it("độ dài 7 bị loại", () => {
    expect(rest.PasswordSchema.safeParse(pw(7)).success).toBe(false);
  });
  it("độ dài 8 được nhận", () => {
    expect(rest.PasswordSchema.safeParse(pw(8)).success).toBe(true);
  });
  it("độ dài 72 được nhận", () => {
    expect(rest.PasswordSchema.safeParse(pw(72)).success).toBe(true);
  });
  it("độ dài 73 bị loại", () => {
    expect(rest.PasswordSchema.safeParse(pw(73)).success).toBe(false);
  });
});

describe("displayName", () => {
  const ok = (s: string) => rest.DisplayNameSchema.safeParse(s).success;
  it("hai khoảng trắng liên tiếp bị loại", () => {
    expect(ok("Tra  Da")).toBe(false);
  });
  it("ký tự đặc biệt bị loại", () => {
    expect(ok("Tra!Da")).toBe(false);
    expect(ok("Tra@Da")).toBe(false);
  });
  it("tên tiếng Việt có dấu được nhận", () => {
    expect(ok("Trà Đá")).toBe(true);
    expect(ok("Nguyễn Văn An")).toBe(true);
  });
  it("độ dài 3..20", () => {
    expect(ok("ab")).toBe(false);
    expect(ok("abc")).toBe(true);
    expect(ok("a".repeat(20))).toBe(true);
    expect(ok("a".repeat(21))).toBe(false);
  });
});

describe("shopName 3..30 (sau trim)", () => {
  const ok = (s: string) =>
    rest.PurchasePlotReqSchema.safeParse({ shopName: s, clientOpId: UUID }).success;
  it("độ dài 2 bị loại", () => {
    expect(ok("ab")).toBe(false);
  });
  it("độ dài 3 được nhận", () => {
    expect(ok("abc")).toBe(true);
  });
  it("độ dài 30 được nhận", () => {
    expect(ok("a".repeat(30))).toBe(true);
  });
  it("độ dài 31 bị loại", () => {
    expect(ok("a".repeat(31))).toBe(false);
  });
  it("PATCH shop dùng cùng giới hạn", () => {
    expect(rest.PatchShopReqSchema.safeParse({ name: "ab" }).success).toBe(false);
    expect(rest.PatchShopReqSchema.safeParse({ name: "a".repeat(31) }).success).toBe(false);
    expect(rest.PatchShopReqSchema.safeParse({ name: "abc" }).success).toBe(true);
  });
});

describe("login password 1..72", () => {
  const login = (n: number) =>
    rest.LoginReqSchema.safeParse({ email: "a@b.co", password: "x".repeat(n) }).success;
  it("độ dài 1 được nhận", () => {
    expect(login(1)).toBe(true);
  });
  it("độ dài 73 bị loại", () => {
    expect(login(73)).toBe(false);
  });
});

describe("limit từ query string", () => {
  const limit = (v: string) => rest.ListWalletTransactionsReqSchema.safeParse({ limit: v });
  it("\"10\" qua và thành số 10", () => {
    const r = limit("10");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(10);
  });
  it("\"0\", \"51\", \"abc\" bị loại", () => {
    expect(limit("0").success).toBe(false);
    expect(limit("51").success).toBe(false);
    expect(limit("abc").success).toBe(false);
  });
});

describe("avatarId", () => {
  it("chỉ nhận avatar_01..avatar_04", () => {
    expect(rest.AvatarIdSchema.safeParse("avatar_01").success).toBe(true);
    expect(rest.AvatarIdSchema.safeParse("avatar_04").success).toBe(true);
    expect(rest.AvatarIdSchema.safeParse("avatar_05").success).toBe(false);
  });
});
