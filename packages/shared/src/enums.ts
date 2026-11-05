// Enum là mảng hằng trùng tên với Prisma enum (§3.2.2). Không import Prisma vào shared.

export const UserRole = ["PLAYER", "ADMIN"] as const;
export type UserRole = (typeof UserRole)[number];

export const GameServerStatus = ["PROVISIONING", "ACTIVE", "DRAINING", "CLOSED"] as const;
export type GameServerStatus = (typeof GameServerStatus)[number];

export const SessionStatus = ["ACTIVE", "ENDED"] as const;
export type SessionStatus = (typeof SessionStatus)[number];

export const SessionEndReason = [
  "LEFT",
  "SWITCHED",
  "REPLACED",
  "GRACE_EXPIRED",
  "SERVER_RESTART",
  "KICKED",
] as const;
export type SessionEndReason = (typeof SessionEndReason)[number];

export const PlotKind = ["RESERVED_DEFAULT", "PURCHASABLE"] as const;
export type PlotKind = (typeof PlotKind)[number];

export const ShopType = ["DEFAULT", "PLAYER_OWNED"] as const;
export type ShopType = (typeof ShopType)[number];

export const ShopStatus = ["OPEN", "PAUSED", "CLOSED"] as const;
export type ShopStatus = (typeof ShopStatus)[number];

export const EmploymentStatus = ["ACTIVE", "RESIGNED", "TERMINATED", "AUTO_RELEASED"] as const;
export type EmploymentStatus = (typeof EmploymentStatus)[number];

export const ApplicationStatus = ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"] as const;
export type ApplicationStatus = (typeof ApplicationStatus)[number];

export const OrderStatus = [
  "PENDING",
  "ACCEPTED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const;
export type OrderStatus = (typeof OrderStatus)[number];

export const WalletTxType = [
  "STARTER_GRANT",
  "DAILY_TOPUP",
  "ORDER_HOLD",
  "ORDER_HOLD_RELEASE",
  "ORDER_CAPTURE",
  "COMMISSION_EARNED",
  "SHOP_OPEN_FEE",
  "TREASURY_WITHDRAWAL",
  "ADMIN_ADJUST",
] as const;
export type WalletTxType = (typeof WalletTxType)[number];

export const ShopTxType = [
  "ORDER_REVENUE",
  "SUPPLY_COST",
  "COMMISSION_PAID",
  "WITHDRAWAL",
  "WITHDRAWAL_FEE",
] as const;
export type ShopTxType = (typeof ShopTxType)[number];
