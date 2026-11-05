import { z } from "zod";
import { MoneySchema, PositiveMoneySchema } from "./money.js";
import {
  ApplicationStatus,
  EmploymentStatus,
  GameServerStatus,
  OrderStatus,
  PlotKind,
  ShopTxType,
  UserKind,
  UserRole,
  WalletTxType,
} from "./enums.js";
import {
  ApplicationViewSchema,
  OrderViewSchema,
  ShopSummarySchema,
  UuidSchema,
  WalletViewSchema,
} from "./events.js";

// ---- Trường dùng chung (§3.3) ----
// Mật khẩu: 8..72 ký tự (đếm theo card M0-E3-T3).
export const PasswordSchema = z.string().min(8).max(72);

// Username: cắt khoảng trắng, lowercase, 3..20 ký tự, chỉ a-z, 0-9, gạch dưới (§3.3).
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/);

// displayName: NFC, 3..20 ký tự, chữ cái Unicode, số, khoảng trắng đơn giữa các từ.
export const DisplayNameSchema = z
  .string()
  .transform((s) => s.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(3)
      .max(20)
      .regex(/^[\p{L}\p{M}\p{N}]+(?: [\p{L}\p{M}\p{N}]+)*$/u),
  );

export const AvatarIdSchema = z.enum(["avatar_01", "avatar_02", "avatar_03", "avatar_04"]);

// Các giới hạn dưới đây KHÔNG có trong plan; chọn tạm và nêu trong báo cáo.
export const ReasonSchema = z.string().trim().min(1).max(200);
export const ShopNameSchema = z.string().trim().min(3).max(30);
export const ServerSlugSchema = z.string().trim().min(1).max(40);
export const ServerNameSchema = z.string().trim().min(1).max(40);

const CursorQuery = z.string().min(1).optional();
const LimitQuery = z.coerce.number().int().min(1).max(50).optional();

// Chuẩn hóa tên để so trùng: NFC → lowercase → bỏ dấu → đ/Đ→d → bỏ khoảng trắng.
export function displayNameKey(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .replace(/\s+/g, "");
}

// ---- Kiểu view REST (§3.3.1) ----
export const UserViewSchema = z
  .object({
    id: UuidSchema,
    kind: z.enum(UserKind),
    username: z.string().nullable(),
    role: z.enum(UserRole),
    mutedUntil: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export const ProfileViewSchema = z
  .object({ userId: UuidSchema, displayName: z.string(), avatarId: z.string() })
  .strict();
export const EmploymentViewSchema = z
  .object({
    id: UuidSchema,
    shopId: UuidSchema,
    serverId: UuidSchema,
    shopName: z.string(),
    status: z.enum(EmploymentStatus),
    hiredAt: z.string(),
    endedAt: z.string().nullable(),
    endReason: z.string().nullable(),
  })
  .strict();
export const EmployeeViewSchema = z
  .object({
    id: UuidSchema,
    userId: UuidSchema,
    displayName: z.string(),
    status: z.enum(EmploymentStatus),
    hiredAt: z.string(),
    endedAt: z.string().nullable(),
  })
  .strict();
export const MenuItemSchema = z
  .object({
    productId: z.string(),
    name: z.string(),
    price: MoneySchema,
    isActive: z.boolean(),
    supplyCost: MoneySchema,
    minPrice: MoneySchema,
    maxPrice: MoneySchema,
  })
  .strict();
export const ShopDetailSchema = ShopSummarySchema.extend({
  ownerId: UuidSchema.nullable(),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
  menu: z.array(MenuItemSchema),
}).strict();
export const PlotViewSchema = z
  .object({
    id: UuidSchema,
    mapSlot: z.string(),
    kind: z.enum(PlotKind),
    openFee: MoneySchema,
    shopId: UuidSchema.nullable(),
    purchasable: z.boolean(),
  })
  .strict();
export const TreasuryViewSchema = z
  .object({ balance: MoneySchema, version: z.number().int() })
  .strict();
export const WalletTxViewSchema = z
  .object({
    id: z.string(),
    type: z.enum(WalletTxType),
    amountDelta: MoneySchema,
    heldDelta: MoneySchema,
    balanceAfter: MoneySchema,
    heldAfter: MoneySchema,
    refType: z.string(),
    refId: z.string(),
    createdAt: z.string(),
  })
  .strict();
export const ShopTxViewSchema = z
  .object({
    id: z.string(),
    type: z.enum(ShopTxType),
    amountDelta: MoneySchema,
    balanceAfter: MoneySchema,
    refType: z.string(),
    refId: z.string(),
    createdAt: z.string(),
  })
  .strict();
export const AdminServerViewSchema = z
  .object({
    id: UuidSchema,
    slug: z.string(),
    name: z.string(),
    status: z.enum(GameServerStatus),
    softCap: z.number().int(),
    hardCap: z.number().int(),
    worldMapId: z.string(),
    createdAt: z.string(),
  })
  .strict();
export const ChatReportViewSchema = z
  .object({
    id: UuidSchema,
    reporterId: UuidSchema,
    reportedUserId: UuidSchema,
    serverId: UuidSchema,
    messageId: UuidSchema,
    messageText: z.string(),
    reason: z.string(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export const ReconcileReportSchema = z
  .object({
    ok: z.boolean(),
    checkedAt: z.string(),
    violations: z.array(
      z
        .object({
          rule: z.string(),
          message: z.string(),
          refType: z.string().nullable(),
          refId: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const HealthResSchema = z
  .object({ status: z.enum(["ok", "degraded"]), db: z.enum(["up", "down"]).optional() })
  .strict();
export const ServerCardSchema = z
  .object({
    id: UuidSchema,
    slug: z.string(),
    name: z.string(),
    online: z.number().int(),
    activeShops: z.number().int(),
    freePlots: z.number().int(),
    load: z.enum(["LOW", "MEDIUM", "HIGH"]),
  })
  .strict();

// Danh sách có cursor và danh sách thường.
const CursorPage = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict();
const ItemList = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) }).strict();

// ---- Auth ----
export const AuthResSchema = z.object({ accessToken: z.string(), user: UserViewSchema }).strict();
export const GuestReqSchema = z
  .object({ displayName: DisplayNameSchema, avatarId: AvatarIdSchema })
  .strict();
export const GuestResSchema = AuthResSchema;
export const UpgradeReqSchema = z
  .object({ username: UsernameSchema, password: PasswordSchema })
  .strict();
export const UpgradeResSchema = AuthResSchema;
// Login chỉ giới hạn trên để chặn payload lớn; mật khẩu sai trả INVALID_CREDENTIALS ở server.
export const LoginReqSchema = z
  .object({ username: UsernameSchema, password: z.string().min(1).max(72) })
  .strict();
export const LoginResSchema = AuthResSchema;
export const RefreshResSchema = z.object({ accessToken: z.string() }).strict();

// ---- Me ----
export const MeResSchema = z.object({ user: UserViewSchema, profile: ProfileViewSchema }).strict();
export const PatchProfileReqSchema = z
  .object({ displayName: DisplayNameSchema.optional(), avatarId: AvatarIdSchema.optional() })
  .strict();
export const PatchProfileResSchema = z.object({ profile: ProfileViewSchema }).strict();
export const GetWalletResSchema = WalletViewSchema.extend({ dailyTopupFloor: MoneySchema }).strict();
export const ListWalletTransactionsReqSchema = z
  .object({ cursor: CursorQuery, limit: LimitQuery })
  .strict();
export const ListWalletTransactionsResSchema = CursorPage(WalletTxViewSchema);
export const DailyTopupResSchema = z
  .object({ granted: MoneySchema, wallet: WalletViewSchema })
  .strict();
export const GetEmploymentResSchema = z.object({ employment: EmploymentViewSchema.nullable() }).strict();
export const ResignEmploymentResSchema = z.object({ employment: EmploymentViewSchema }).strict();
export const ListMyApplicationsResSchema = ItemList(ApplicationViewSchema);
export const WithdrawApplicationResSchema = z
  .object({ application: ApplicationViewSchema })
  .strict();
export const ListMyOrdersReqSchema = z
  .object({ status: z.enum(OrderStatus).optional(), cursor: CursorQuery })
  .strict();
export const ListMyOrdersResSchema = CursorPage(OrderViewSchema);

// ---- Servers ----
export const ListServersResSchema = ItemList(ServerCardSchema);
export const QuickJoinResSchema = z.object({ serverId: UuidSchema }).strict();
export const ListShopsResSchema = ItemList(ShopSummarySchema);
export const GetShopResSchema = ShopDetailSchema;
export const ListPlotsResSchema = ItemList(PlotViewSchema);
export const PurchasePlotReqSchema = z
  .object({ shopName: ShopNameSchema, clientOpId: UuidSchema })
  .strict();
export const PurchasePlotResSchema = z
  .object({ shop: ShopDetailSchema, wallet: WalletViewSchema })
  .strict();
export const PatchShopReqSchema = z
  .object({
    status: z.enum(["OPEN", "PAUSED"]).optional(),
    name: ShopNameSchema.optional(),
    isHiring: z.boolean().optional(),
  })
  .strict();
export const PatchShopResSchema = ShopDetailSchema;
// price là ý định của chủ quán: không nhận "0" (PositiveMoneySchema).
export const PutMenuItemReqSchema = z
  .object({ price: PositiveMoneySchema, isActive: z.boolean() })
  .strict();
export const PutMenuItemResSchema = MenuItemSchema;
export const ListShopOrdersReqSchema = z
  .object({ status: z.enum(OrderStatus).optional(), cursor: CursorQuery })
  .strict();
export const ListShopOrdersResSchema = CursorPage(OrderViewSchema);
export const ListShopApplicationsReqSchema = z
  .object({ status: z.enum(ApplicationStatus).optional() })
  .strict();
export const ListShopApplicationsResSchema = ItemList(ApplicationViewSchema);
export const ListShopEmployeesResSchema = ItemList(EmployeeViewSchema);
export const TerminateEmployeeReqSchema = z.object({ reason: ReasonSchema }).strict();
export const TerminateEmployeeResSchema = z.object({ employee: EmployeeViewSchema }).strict();
export const GetTreasuryResSchema = TreasuryViewSchema;
export const ListTreasuryTransactionsReqSchema = z.object({ cursor: CursorQuery }).strict();
export const ListTreasuryTransactionsResSchema = CursorPage(ShopTxViewSchema);
// amount là số tiền rút do chủ quán nhập: PositiveMoneySchema, không nhận "0".
export const WithdrawTreasuryReqSchema = z
  .object({ amount: PositiveMoneySchema, clientOpId: UuidSchema })
  .strict();
export const WithdrawTreasuryResSchema = z
  .object({ treasury: TreasuryViewSchema, wallet: WalletViewSchema, fee: MoneySchema })
  .strict();
export const CreateChatReportReqSchema = z
  .object({ messageId: UuidSchema, reason: ReasonSchema })
  .strict();

// ---- Admin ----
export const CreateServerReqSchema = z
  .object({ slug: ServerSlugSchema, name: ServerNameSchema })
  .strict();
export const CreateServerResSchema = z.object({ server: AdminServerViewSchema }).strict();
export const MuteUserReqSchema = z
  .object({ until: z.iso.datetime(), reason: ReasonSchema })
  .strict();
export const BanUserReqSchema = z.object({ reason: ReasonSchema }).strict();
export const ListReportsReqSchema = z
  .object({ unresolved: z.stringbool().optional() })
  .strict();
export const ListReportsResSchema = ItemList(ChatReportViewSchema);
export const AdminTerminateEmployeeReqSchema = TerminateEmployeeReqSchema;
export const AdminTerminateEmployeeResSchema = TerminateEmployeeResSchema;
export const ReconcileResSchema = ReconcileReportSchema;

export type GuestReq = z.infer<typeof GuestReqSchema>;
export type UpgradeReq = z.infer<typeof UpgradeReqSchema>;
export type LoginReq = z.infer<typeof LoginReqSchema>;
export type PatchProfileReq = z.infer<typeof PatchProfileReqSchema>;
export type PurchasePlotReq = z.infer<typeof PurchasePlotReqSchema>;
export type PutMenuItemReq = z.infer<typeof PutMenuItemReqSchema>;
export type WithdrawTreasuryReq = z.infer<typeof WithdrawTreasuryReqSchema>;
export type ShopDetail = z.infer<typeof ShopDetailSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
