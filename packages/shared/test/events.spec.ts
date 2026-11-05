import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ClientEventSchemas,
  ServerEventSchemas,
  EVENT_RATE_LIMITS,
  ChatSendReqSchema,
  OrderCreateReqSchema,
  PlayerMoveReqSchema,
  WalletViewSchema,
  WorldJoinReqSchema,
  ShopApplyReqSchema,
  OrderRejectReqSchema,
  PlayerSitReqSchema,
  WorldStateSchema,
  PlayerViewSchema,
  OrderViewSchema,
  WalletUpdatedEvtSchema,
  ShopType,
  ShopStatus,
  ApplicationStatus,
  OrderStatus,
  WalletTxType,
  PlotKind,
  EmploymentStatus,
  SessionEndReason,
} from "../src/index.js";

// Danh sách tên event ghi tường minh từ §3.4.2 (17 event).
const PLAN_CLIENT_EVENTS = [
  "world:ping",
  "world:join",
  "world:leave",
  "world:resync",
  "server:switch",
  "player:move",
  "player:interact",
  "player:sit",
  "player:stand",
  "chat:send",
  "shop:apply",
  "shop:application:respond",
  "shop:order:create",
  "shop:order:cancel",
  "shop:order:accept",
  "shop:order:reject",
  "shop:order:complete",
];

// Danh sách tên event ghi tường minh từ §3.4.3 (14 event).
const PLAN_SERVER_EVENTS = [
  "world:state",
  "player:joined",
  "player:left",
  "player:moved",
  "player:interacted",
  "chat:message",
  "shop:updated",
  "shop:application:updated",
  "shop:order:created",
  "shop:order:updated",
  "wallet:updated",
  "employment:updated",
  "server:population",
  "session:replaced",
];

// Tên field không được xuất hiện trong schema của lệnh client (tiền và danh tính).
const FORBIDDEN_CLIENT_FIELDS = ["userId", "price", "unitPrice", "amount", "total", "commission"];

// Duyệt đệ quy JSON schema: thu thập mọi tên property và kiểm tra object nào thiếu additionalProperties: false.
function walk(node: unknown, names: Set<string>, nonStrict: string[], path: string): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, names, nonStrict, `${path}[${i}]`));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object" || obj.properties !== undefined) {
    if (obj.additionalProperties !== false) nonStrict.push(path);
  }
  if (obj.properties && typeof obj.properties === "object") {
    for (const [key, value] of Object.entries(obj.properties as Record<string, unknown>)) {
      names.add(key);
      walk(value, names, nonStrict, `${path}.${key}`);
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === "properties") continue;
    walk(value, names, nonStrict, `${path}.${key}`);
  }
}

const UUID_A = "3b241101-e2bb-4255-8caf-4136c566a962";
const UUID_B = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("event inventory", () => {
  it("có đúng 17 client event và 14 server event theo plan", () => {
    expect(PLAN_CLIENT_EVENTS).toHaveLength(17);
    expect(PLAN_SERVER_EVENTS).toHaveLength(14);
  });

  it("EVENT_RATE_LIMITS khớp đúng danh sách client event", () => {
    expect(Object.keys(EVENT_RATE_LIMITS).sort()).toEqual([...PLAN_CLIENT_EVENTS].sort());
  });

  it("ClientEventSchemas khớp đúng danh sách client event", () => {
    expect(Object.keys(ClientEventSchemas).sort()).toEqual([...PLAN_CLIENT_EVENTS].sort());
  });

  it("ServerEventSchemas khớp đúng danh sách server event", () => {
    expect(Object.keys(ServerEventSchemas).sort()).toEqual([...PLAN_SERVER_EVENTS].sort());
  });

  it("có các event (thêm) theo plan", () => {
    for (const name of ["shop:order:cancel", "shop:order:reject", "employment:updated", "session:replaced"]) {
      const inClient = name in ClientEventSchemas;
      const inServer = name in ServerEventSchemas;
      expect(inClient || inServer).toBe(true);
    }
  });

  it("rate limit đúng bảng §3.4.2", () => {
    expect(EVENT_RATE_LIMITS).toEqual({
      "world:ping": { capacity: 2, refillPerSec: 0.5 },
      "world:join": { capacity: 3, refillPerSec: 0.2 },
      "world:leave": { capacity: 3, refillPerSec: 0.2 },
      "world:resync": { capacity: 2, refillPerSec: 0.1 },
      "server:switch": { capacity: 2, refillPerSec: 0.1 },
      "player:move": { capacity: 20, refillPerSec: 12 },
      "player:interact": { capacity: 3, refillPerSec: 0.5 },
      "player:sit": { capacity: 3, refillPerSec: 1 },
      "player:stand": { capacity: 3, refillPerSec: 1 },
      "chat:send": { capacity: 5, refillPerSec: 0.5 },
      "shop:apply": { capacity: 3, refillPerSec: 0.05 },
      "shop:application:respond": { capacity: 5, refillPerSec: 0.5 },
      "shop:order:create": { capacity: 3, refillPerSec: 0.5 },
      "shop:order:cancel": { capacity: 5, refillPerSec: 0.5 },
      "shop:order:accept": { capacity: 5, refillPerSec: 2 },
      "shop:order:reject": { capacity: 5, refillPerSec: 1 },
      "shop:order:complete": { capacity: 5, refillPerSec: 2 },
    });
  });
});

describe("client command schemas", () => {
  it("mọi schema lệnh client là strict và không có field userId/giá/số tiền", () => {
    const names = new Set<string>();
    const nonStrict: string[] = [];
    for (const [event, schema] of Object.entries(ClientEventSchemas)) {
      walk(z.toJSONSchema(schema as z.ZodType), names, nonStrict, event);
    }
    expect(nonStrict).toEqual([]);
    for (const forbidden of FORBIDDEN_CLIENT_FIELDS) {
      expect(names.has(forbidden), `field ${forbidden} xuất hiện trong schema lệnh client`).toBe(false);
    }
  });

  it("payload hợp lệ qua, field lạ bị loại", () => {
    expect(WorldJoinReqSchema.safeParse({ serverId: UUID_A }).success).toBe(true);
    expect(WorldJoinReqSchema.safeParse({ serverId: UUID_A, extra: 1 }).success).toBe(false);
    expect(PlayerMoveReqSchema.safeParse({ x: 10, y: 20, dir: "up", seq: 1 }).success).toBe(true);
    expect(PlayerMoveReqSchema.safeParse({ x: 10, y: 20, dir: "up", seq: 1, userId: UUID_B }).success).toBe(false);
    expect(PlayerSitReqSchema.safeParse({ seatId: "D1-S1", price: "5" }).success).toBe(false);
  });

  it("OrderCreateReq: items rỗng hoặc quá 5 dòng bị loại", () => {
    const base = { shopId: UUID_A, clientOpId: UUID_B };
    const line = { productId: "p1", quantity: 1 };
    expect(OrderCreateReqSchema.safeParse({ ...base, items: [line] }).success).toBe(true);
    expect(OrderCreateReqSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(OrderCreateReqSchema.safeParse({ ...base, items: Array(6).fill(line) }).success).toBe(false);
    expect(OrderCreateReqSchema.safeParse({ ...base, items: Array(5).fill(line) }).success).toBe(true);
  });

  it("OrderCreateReq: quantity 0 hoặc 11 bị loại", () => {
    const base = { shopId: UUID_A, clientOpId: UUID_B };
    expect(OrderCreateReqSchema.safeParse({ ...base, items: [{ productId: "p1", quantity: 0 }] }).success).toBe(false);
    expect(OrderCreateReqSchema.safeParse({ ...base, items: [{ productId: "p1", quantity: 11 }] }).success).toBe(false);
    expect(OrderCreateReqSchema.safeParse({ ...base, items: [{ productId: "p1", quantity: 10 }] }).success).toBe(true);
  });

  it("ChatSendReq: text chỉ có khoảng trắng bị loại", () => {
    expect(ChatSendReqSchema.safeParse({ text: "   ", clientMsgId: UUID_A }).success).toBe(false);
    expect(ChatSendReqSchema.safeParse({ text: " hi ", clientMsgId: UUID_A }).success).toBe(true);
  });

  it("clientOpId không phải UUID bị loại", () => {
    const base = { shopId: UUID_A, items: [{ productId: "p1", quantity: 1 }] };
    expect(OrderCreateReqSchema.safeParse({ ...base, clientOpId: "not-a-uuid" }).success).toBe(false);
  });

  it("ShopApplyReq: message quá 200 ký tự bị loại, OrderRejectReq: reason quá 100 bị loại", () => {
    expect(ShopApplyReqSchema.safeParse({ shopId: UUID_A, message: "a".repeat(201) }).success).toBe(false);
    expect(ShopApplyReqSchema.safeParse({ shopId: UUID_A, message: "a".repeat(200) }).success).toBe(true);
    expect(OrderRejectReqSchema.safeParse({ orderId: UUID_A, reason: "a".repeat(101) }).success).toBe(false);
  });
});

describe("server payload schemas", () => {
  it("số tiền là chuỗi thập phân, không phải number", () => {
    const wallet = { balance: "100", held: "0", available: "100", version: 1 };
    expect(WalletViewSchema.safeParse(wallet).success).toBe(true);
    expect(WalletViewSchema.safeParse({ ...wallet, balance: 100 }).success).toBe(false);
    expect(WalletUpdatedEvtSchema.safeParse({ ...wallet, reason: "ORDER_HOLD" }).success).toBe(true);
  });

  it("OrderView.total và unitPrice dùng MoneySchema", () => {
    const order = {
      id: UUID_A,
      shopId: UUID_A,
      serverId: UUID_A,
      customerId: UUID_B,
      customerName: "A",
      handlerId: null,
      status: "PENDING",
      total: "10",
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:05:00Z",
      acceptedAt: null,
      acceptExpiresAt: null,
      earliestCompleteAt: null,
      items: [{ productId: "p1", name: "Trà", unitPrice: "5", quantity: 2 }],
    };
    expect(OrderViewSchema.safeParse(order).success).toBe(true);
    expect(OrderViewSchema.safeParse({ ...order, total: 10 }).success).toBe(false);
    expect(OrderViewSchema.safeParse({ ...order, items: [{ ...order.items[0], unitPrice: 5 }] }).success).toBe(false);
  });

  it("WorldState chứa các trường bắt buộc của §3.4.1", () => {
    expect(WorldStateSchema.safeParse({}).success).toBe(false);
    expect(PlayerViewSchema.shape).toHaveProperty("seatId");
  });
});

describe("enum arrays", () => {
  it("giá trị enum khớp §3.2.2", () => {
    expect([...ShopType]).toEqual(["DEFAULT", "PLAYER_OWNED"]);
    expect([...ShopStatus]).toEqual(["OPEN", "PAUSED", "CLOSED"]);
    expect([...ApplicationStatus]).toEqual(["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"]);
    expect([...OrderStatus]).toEqual(["PENDING", "ACCEPTED", "COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"]);
    expect([...WalletTxType]).toEqual([
      "STARTER_GRANT", "DAILY_TOPUP", "ORDER_HOLD", "ORDER_HOLD_RELEASE", "ORDER_CAPTURE",
      "COMMISSION_EARNED", "SHOP_OPEN_FEE", "TREASURY_WITHDRAWAL", "ADMIN_ADJUST",
    ]);
    expect([...PlotKind]).toEqual(["RESERVED_DEFAULT", "PURCHASABLE"]);
    expect([...EmploymentStatus]).toEqual(["ACTIVE", "RESIGNED", "TERMINATED", "DAILY_RESET"]);
    expect([...SessionEndReason]).toEqual(["LEFT", "SWITCHED", "REPLACED", "GRACE_EXPIRED", "SERVER_RESTART", "KICKED"]);
  });
});

describe("player:interacted (§3.4.3)", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const schema = ServerEventSchemas["player:interacted"];

  it("chỉ kind thì qua", () => {
    expect(schema.safeParse({ userId, kind: "WAVE" }).success).toBe(true);
  });

  it("chỉ state thì qua", () => {
    expect(schema.safeParse({ userId, state: "DISCONNECTED" }).success).toBe(true);
    expect(schema.safeParse({ userId, state: "RECONNECTED" }).success).toBe(true);
  });

  it("không có cả kind lẫn state thì bị loại; field lạ bị loại", () => {
    expect(schema.safeParse({ userId }).success).toBe(false);
    expect(schema.safeParse({ userId, kind: "NOD", extra: 1 }).success).toBe(false);
  });
});
