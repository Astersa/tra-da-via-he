import { z } from "zod";
import type { Ack } from "./ack.js";
import { MoneySchema } from "./money.js";
import {
  ApplicationStatus,
  EmploymentStatus,
  OrderStatus,
  PlotKind,
  SessionEndReason,
  ShopStatus,
  ShopType,
  WalletTxType,
} from "./enums.js";

// §3.4.1 kiểu nguyên thủy. Tiền dùng MoneySchema (chuỗi thập phân), không dùng number/bigint.
export const UuidSchema = z.uuid();
export const DirSchema = z.enum(["up", "down", "left", "right"]);
export const EmptySchema = z.object({}).strict();

const ApplicationStatusSchema = z.enum(ApplicationStatus);
const OrderStatusSchema = z.enum(OrderStatus);
const PlotKindSchema = z.enum(PlotKind);
const ShopTypeSchema = z.enum(ShopType);
const ShopStatusSchema = z.enum(ShopStatus);
const EmploymentStatusSchema = z.enum(EmploymentStatus);
const SessionEndReasonSchema = z.enum(SessionEndReason);
const WalletTxTypeSchema = z.enum(WalletTxType);

// ---- Client → Server ----
export const WorldJoinReqSchema = z
  .object({ serverId: UuidSchema, resumeSessionId: UuidSchema.optional() })
  .strict();
export const ServerSwitchReqSchema = z.object({ targetServerId: UuidSchema }).strict();
export const PlayerMoveReqSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    dir: DirSchema,
    seq: z.number().int(),
  })
  .strict();
export const PlayerInteractReqSchema = z
  .object({ kind: z.enum(["WAVE", "CHEERS", "NOD"]) })
  .strict();
export const PlayerSitReqSchema = z.object({ seatId: z.string() }).strict();
export const ChatSendReqSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    clientMsgId: UuidSchema,
  })
  .strict();
export const ShopApplyReqSchema = z
  .object({ shopId: UuidSchema, message: z.string().max(200).optional() })
  .strict();
export const ApplicationRespondReqSchema = z
  .object({
    applicationId: UuidSchema,
    decision: z.enum(["ACCEPT", "REJECT"]),
  })
  .strict();
export const OrderCreateReqSchema = z
  .object({
    shopId: UuidSchema,
    items: z
      .array(
        z
          .object({
            productId: z.string(),
            quantity: z.number().int().min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    clientOpId: UuidSchema,
  })
  .strict();
export const OrderRefReqSchema = z.object({ orderId: UuidSchema }).strict();
export const OrderRejectReqSchema = z
  .object({ orderId: UuidSchema, reason: z.string().max(100).optional() })
  .strict();

// ---- Server → Client ----
export const PlayerViewSchema = z
  .object({
    userId: UuidSchema,
    displayName: z.string(),
    avatarId: z.string(),
    x: z.number(),
    y: z.number(),
    dir: DirSchema,
    seatId: z.string().nullable(),
    connected: z.boolean(),
  })
  .strict();
export const WalletViewSchema = z
  .object({
    balance: MoneySchema,
    held: MoneySchema,
    available: MoneySchema,
    version: z.number().int(),
  })
  .strict();
export const OrderViewSchema = z
  .object({
    id: UuidSchema,
    shopId: UuidSchema,
    serverId: UuidSchema,
    customerId: UuidSchema,
    customerName: z.string(),
    handlerId: UuidSchema.nullable(),
    status: OrderStatusSchema,
    total: MoneySchema,
    version: z.number().int(),
    createdAt: z.string(),
    expiresAt: z.string(),
    acceptedAt: z.string().nullable(),
    acceptExpiresAt: z.string().nullable(),
    earliestCompleteAt: z.string().nullable(),
    items: z.array(
      z
        .object({
          productId: z.string(),
          name: z.string(),
          unitPrice: MoneySchema,
          quantity: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export const ShopSummarySchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    type: ShopTypeSchema,
    mapSlot: z.string(),
    status: ShopStatusSchema,
    isHiring: z.boolean(),
    acceptingOrders: z.boolean(),
    onlineStaff: z.number().int(),
  })
  .strict();
export const ChatMessageSchema = z
  .object({
    id: UuidSchema,
    userId: UuidSchema,
    displayName: z.string(),
    text: z.string(),
    at: z.string(),
  })
  .strict();
export const ApplicationViewSchema = z
  .object({
    id: UuidSchema,
    shopId: UuidSchema,
    userId: UuidSchema,
    displayName: z.string(),
    status: ApplicationStatusSchema,
    message: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export const WorldStateSchema = z
  .object({
    sessionId: UuidSchema,
    serverId: UuidSchema,
    self: PlayerViewSchema,
    players: z.array(PlayerViewSchema),
    shops: z.array(ShopSummarySchema),
    plots: z.array(
      z
        .object({
          id: UuidSchema,
          mapSlot: z.string(),
          kind: PlotKindSchema,
          openFee: MoneySchema,
          shopId: UuidSchema.nullable(),
        })
        .strict(),
    ),
    takenSeats: z.array(z.object({ seatId: z.string(), userId: UuidSchema }).strict()),
    recentChat: z.array(ChatMessageSchema).max(50),
    wallet: WalletViewSchema,
    myOpenOrders: z.array(OrderViewSchema),
    staff: z
      .object({
        role: z.enum(["OWNER", "EMPLOYEE"]),
        shopId: UuidSchema,
        queue: z.array(OrderViewSchema),
      })
      .strict()
      .nullable(),
    mapVersion: z.number().int(),
  })
  .strict();
export const PlayerMovedEvtSchema = z
  .object({
    moves: z.array(
      z
        .object({
          userId: UuidSchema,
          x: z.number(),
          y: z.number(),
          dir: DirSchema,
          seq: z.number().int(),
          corrected: z.literal(true).optional(),
        })
        .strict(),
    ),
  })
  .strict();

// Payload inline của §3.4.3.
export const PlayerLeftEvtSchema = z
  .object({ userId: UuidSchema, reason: SessionEndReasonSchema })
  .strict();
export const PlayerInteractedEvtSchema = z
  .object({
    userId: UuidSchema,
    kind: z.enum(["WAVE", "CHEERS", "NOD"]),
    seatId: z.string().optional(),
    state: z.enum(["SIT", "STAND", "DISCONNECTED", "RECONNECTED"]).optional(),
  })
  .strict();
export const WalletUpdatedEvtSchema = WalletViewSchema.extend({
  reason: WalletTxTypeSchema,
}).strict();
export const EmploymentUpdatedEvtSchema = z
  .object({
    employment: z
      .object({
        shopId: UuidSchema,
        serverId: UuidSchema,
        status: EmploymentStatusSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const ServerPopulationEvtSchema = z
  .object({
    servers: z.array(
      z
        .object({
          id: UuidSchema,
          online: z.number().int(),
          load: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
export const SessionReplacedEvtSchema = z
  .object({ reason: z.enum(["NEW_TAB", "SWITCHED"]) })
  .strict();

// ---- Kiểu TypeScript suy ra từ schema ----
export type Dir = z.infer<typeof DirSchema>;
export type WorldJoinReq = z.infer<typeof WorldJoinReqSchema>;
export type ServerSwitchReq = z.infer<typeof ServerSwitchReqSchema>;
export type PlayerMoveReq = z.infer<typeof PlayerMoveReqSchema>;
export type PlayerInteractReq = z.infer<typeof PlayerInteractReqSchema>;
export type PlayerSitReq = z.infer<typeof PlayerSitReqSchema>;
export type ChatSendReq = z.infer<typeof ChatSendReqSchema>;
export type ShopApplyReq = z.infer<typeof ShopApplyReqSchema>;
export type ApplicationRespondReq = z.infer<typeof ApplicationRespondReqSchema>;
export type OrderCreateReq = z.infer<typeof OrderCreateReqSchema>;
export type OrderRefReq = z.infer<typeof OrderRefReqSchema>;
export type OrderRejectReq = z.infer<typeof OrderRejectReqSchema>;
export type PlayerView = z.infer<typeof PlayerViewSchema>;
export type WalletView = z.infer<typeof WalletViewSchema>;
export type OrderView = z.infer<typeof OrderViewSchema>;
export type ShopSummary = z.infer<typeof ShopSummarySchema>;
export type WorldState = z.infer<typeof WorldStateSchema>;
export type PlayerMovedEvt = z.infer<typeof PlayerMovedEvtSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ApplicationView = z.infer<typeof ApplicationViewSchema>;

// ---- Bảng schema theo tên event (§3.4.2, §3.4.3) ----
// Client → Server: tên → schema payload. player:move không ack; các event còn lại đều ack.
export const ClientEventSchemas = {
  "world:ping": EmptySchema,
  "world:join": WorldJoinReqSchema,
  "world:leave": EmptySchema,
  "world:resync": EmptySchema,
  "server:switch": ServerSwitchReqSchema,
  "player:move": PlayerMoveReqSchema,
  "player:interact": PlayerInteractReqSchema,
  "player:sit": PlayerSitReqSchema,
  "player:stand": EmptySchema,
  "chat:send": ChatSendReqSchema,
  "shop:apply": ShopApplyReqSchema,
  "shop:application:respond": ApplicationRespondReqSchema,
  "shop:order:create": OrderCreateReqSchema,
  "shop:order:cancel": OrderRefReqSchema,
  "shop:order:accept": OrderRefReqSchema,
  "shop:order:reject": OrderRejectReqSchema,
  "shop:order:complete": OrderRefReqSchema,
} as const;
export type ClientEvent = keyof typeof ClientEventSchemas;

// Server → Client: tên → schema payload.
export const ServerEventSchemas = {
  "world:state": WorldStateSchema,
  "player:joined": PlayerViewSchema,
  "player:left": PlayerLeftEvtSchema,
  "player:moved": PlayerMovedEvtSchema,
  "player:interacted": PlayerInteractedEvtSchema,
  "chat:message": ChatMessageSchema,
  "shop:updated": ShopSummarySchema,
  "shop:application:updated": ApplicationViewSchema,
  "shop:order:created": OrderViewSchema,
  "shop:order:updated": OrderViewSchema,
  "wallet:updated": WalletUpdatedEvtSchema,
  "employment:updated": EmploymentUpdatedEvtSchema,
  "server:population": ServerPopulationEvtSchema,
  "session:replaced": SessionReplacedEvtSchema,
} as const;
export type ServerEvent = keyof typeof ServerEventSchemas;

// Token bucket theo từng user: capacity / refillPerSec (§3.4.2, cột Rate limit).
export const EVENT_RATE_LIMITS: Record<ClientEvent, { capacity: number; refillPerSec: number }> = {
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
};

// ---- Socket.IO generic (§3.4) ----
export interface ClientToServerEvents {
  "world:ping": (req: Record<string, never>, ack: (res: Ack<Record<string, never>>) => void) => void;
  "world:join": (req: WorldJoinReq, ack: (res: Ack<WorldState>) => void) => void;
  "world:leave": (req: Record<string, never>, ack: (res: Ack<Record<string, never>>) => void) => void;
  "world:resync": (req: Record<string, never>, ack: (res: Ack<WorldState>) => void) => void;
  "server:switch": (req: ServerSwitchReq, ack: (res: Ack<WorldState>) => void) => void;
  "player:move": (req: PlayerMoveReq) => void;
  "player:interact": (req: PlayerInteractReq, ack: (res: Ack<Record<string, never>>) => void) => void;
  "player:sit": (req: PlayerSitReq, ack: (res: Ack<{ seatId: string }>) => void) => void;
  "player:stand": (req: Record<string, never>, ack: (res: Ack<Record<string, never>>) => void) => void;
  "chat:send": (req: ChatSendReq, ack: (res: Ack<{ id: string }>) => void) => void;
  "shop:apply": (req: ShopApplyReq, ack: (res: Ack<ApplicationView>) => void) => void;
  "shop:application:respond": (req: ApplicationRespondReq, ack: (res: Ack<ApplicationView>) => void) => void;
  "shop:order:create": (req: OrderCreateReq, ack: (res: Ack<OrderView>) => void) => void;
  "shop:order:cancel": (req: OrderRefReq, ack: (res: Ack<OrderView>) => void) => void;
  "shop:order:accept": (req: OrderRefReq, ack: (res: Ack<OrderView>) => void) => void;
  "shop:order:reject": (req: OrderRejectReq, ack: (res: Ack<OrderView>) => void) => void;
  "shop:order:complete": (req: OrderRefReq, ack: (res: Ack<OrderView>) => void) => void;
}

export interface ServerToClientEvents {
  "world:state": (evt: WorldState) => void;
  "player:joined": (evt: PlayerView) => void;
  "player:left": (evt: z.infer<typeof PlayerLeftEvtSchema>) => void;
  "player:moved": (evt: PlayerMovedEvt) => void;
  "player:interacted": (evt: z.infer<typeof PlayerInteractedEvtSchema>) => void;
  "chat:message": (evt: ChatMessage) => void;
  "shop:updated": (evt: ShopSummary) => void;
  "shop:application:updated": (evt: ApplicationView) => void;
  "shop:order:created": (evt: OrderView) => void;
  "shop:order:updated": (evt: OrderView) => void;
  "wallet:updated": (evt: z.infer<typeof WalletUpdatedEvtSchema>) => void;
  "employment:updated": (evt: z.infer<typeof EmploymentUpdatedEvtSchema>) => void;
  "server:population": (evt: z.infer<typeof ServerPopulationEvtSchema>) => void;
  "session:replaced": (evt: z.infer<typeof SessionReplacedEvtSchema>) => void;
}
