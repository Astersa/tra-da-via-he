-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('GUEST', 'REGISTERED');

-- CreateEnum
CREATE TYPE "GameServerStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'DRAINING', 'CLOSED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('LEFT', 'SWITCHED', 'REPLACED', 'GRACE_EXPIRED', 'SERVER_RESTART', 'KICKED');

-- CreateEnum
CREATE TYPE "PlotKind" AS ENUM ('RESERVED_DEFAULT', 'PURCHASABLE');

-- CreateEnum
CREATE TYPE "ShopType" AS ENUM ('DEFAULT', 'PLAYER_OWNED');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'TERMINATED', 'DAILY_RESET');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('STARTER_GRANT', 'DAILY_TOPUP', 'ORDER_HOLD', 'ORDER_HOLD_RELEASE', 'ORDER_CAPTURE', 'COMMISSION_EARNED', 'SHOP_OPEN_FEE', 'TREASURY_WITHDRAWAL', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "ShopTxType" AS ENUM ('ORDER_REVENUE', 'SUPPLY_COST', 'COMMISSION_PAID', 'WITHDRAWAL', 'WITHDRAWAL_FEE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "kind" "UserKind" NOT NULL DEFAULT 'GUEST',
    "username" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "mutedUntil" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(20) NOT NULL,
    "displayNameKey" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL DEFAULT 'avatar_01',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "heldBalance" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" BIGSERIAL NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "amountDelta" BIGINT NOT NULL,
    "heldDelta" BIGINT NOT NULL DEFAULT 0,
    "balanceAfter" BIGINT NOT NULL,
    "heldAfter" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "txGroupId" UUID NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "serverId" UUID,
    "shopId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "serverId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReport" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reportedUserId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "messageText" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldMap" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "WorldMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameServer" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "GameServerStatus" NOT NULL DEFAULT 'PROVISIONING',
    "softCap" INTEGER NOT NULL DEFAULT 15,
    "hardCap" INTEGER NOT NULL DEFAULT 25,
    "worldMapId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "endReason" "SessionEndReason",
    "lastX" INTEGER,
    "lastY" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ServerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPlot" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "mapSlot" TEXT NOT NULL,
    "kind" "PlotKind" NOT NULL,
    "openFee" BIGINT NOT NULL,

    CONSTRAINT "ShopPlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "type" "ShopType" NOT NULL,
    "defaultSlot" INTEGER,
    "ownerId" UUID,
    "name" VARCHAR(30) NOT NULL,
    "status" "ShopStatus" NOT NULL DEFAULT 'OPEN',
    "isHiring" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopTreasury" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopTreasury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopTransaction" (
    "id" BIGSERIAL NOT NULL,
    "treasuryId" UUID NOT NULL,
    "type" "ShopTxType" NOT NULL,
    "amountDelta" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "txGroupId" UUID NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "serverId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopEmployee" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "hiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" UUID,
    "endReason" TEXT,

    CONSTRAINT "ShopEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeApplication" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "message" VARCHAR(200),
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplyCost" BIGINT NOT NULL,
    "minPrice" BIGINT NOT NULL,
    "maxPrice" BIGINT NOT NULL,
    "defaultPrice" BIGINT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopMenu" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "productId" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "handlerId" UUID,
    "ownerIdSnapshot" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" BIGINT NOT NULL,
    "supplyCostTotal" BIGINT NOT NULL,
    "commissionBpsSnapshot" INTEGER NOT NULL,
    "commissionAmount" BIGINT,
    "profitAmount" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptExpiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "unitPriceSnapshot" BIGINT NOT NULL,
    "unitSupplyCostSnapshot" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderEvent" (
    "id" BIGSERIAL NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorUserId" UUID,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_displayNameKey_key" ON "PlayerProfile"("displayNameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_id_idx" ON "WalletTransaction"("walletId", "id" DESC);

-- CreateIndex
CREATE INDEX "WalletTransaction_refType_refId_idx" ON "WalletTransaction"("refType", "refId");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_createdAt_idx" ON "WalletTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_scope_key_key" ON "IdempotencyRecord"("userId", "scope", "key");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ChatReport_resolvedAt_createdAt_idx" ON "ChatReport"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReport_reporterId_messageId_key" ON "ChatReport"("reporterId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "GameServer_slug_key" ON "GameServer"("slug");

-- CreateIndex
CREATE INDEX "GameServer_status_idx" ON "GameServer"("status");

-- CreateIndex
CREATE INDEX "ServerSession_serverId_status_idx" ON "ServerSession"("serverId", "status");

-- CreateIndex
CREATE INDEX "ServerSession_userId_startedAt_idx" ON "ServerSession"("userId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ShopPlot_id_serverId_key" ON "ShopPlot"("id", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopPlot_serverId_mapSlot_key" ON "ShopPlot"("serverId", "mapSlot");

-- CreateIndex
CREATE INDEX "Shop_serverId_status_idx" ON "Shop"("serverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_id_serverId_key" ON "Shop"("id", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopTreasury_shopId_key" ON "ShopTreasury"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopTransaction_idempotencyKey_key" ON "ShopTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ShopTransaction_treasuryId_id_idx" ON "ShopTransaction"("treasuryId", "id" DESC);

-- CreateIndex
CREATE INDEX "ShopTransaction_refType_refId_idx" ON "ShopTransaction"("refType", "refId");

-- CreateIndex
CREATE INDEX "ShopTransaction_type_createdAt_idx" ON "ShopTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ShopEmployee_shopId_status_idx" ON "ShopEmployee"("shopId", "status");

-- CreateIndex
CREATE INDEX "ShopEmployee_userId_hiredAt_idx" ON "ShopEmployee"("userId", "hiredAt" DESC);

-- CreateIndex
CREATE INDEX "EmployeeApplication_shopId_status_idx" ON "EmployeeApplication"("shopId", "status");

-- CreateIndex
CREATE INDEX "EmployeeApplication_userId_status_idx" ON "EmployeeApplication"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShopMenu_shopId_productId_key" ON "ShopMenu"("shopId", "productId");

-- CreateIndex
CREATE INDEX "ShopOrder_customerId_status_idx" ON "ShopOrder"("customerId", "status");

-- CreateIndex
CREATE INDEX "ShopOrder_customerId_handlerId_closedAt_idx" ON "ShopOrder"("customerId", "handlerId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrderItem_orderId_productId_key" ON "ShopOrderItem"("orderId", "productId");

-- CreateIndex
CREATE INDEX "ShopOrderEvent_orderId_id_idx" ON "ShopOrderEvent"("orderId", "id");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServer" ADD CONSTRAINT "GameServer_worldMapId_fkey" FOREIGN KEY ("worldMapId") REFERENCES "WorldMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerSession" ADD CONSTRAINT "ServerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerSession" ADD CONSTRAINT "ServerSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPlot" ADD CONSTRAINT "ShopPlot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_plotId_serverId_fkey" FOREIGN KEY ("plotId", "serverId") REFERENCES "ShopPlot"("id", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopTreasury" ADD CONSTRAINT "ShopTreasury_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopTransaction" ADD CONSTRAINT "ShopTransaction_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "ShopTreasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopEmployee" ADD CONSTRAINT "ShopEmployee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopEmployee" ADD CONSTRAINT "ShopEmployee_shopId_serverId_fkey" FOREIGN KEY ("shopId", "serverId") REFERENCES "Shop"("id", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeApplication" ADD CONSTRAINT "EmployeeApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeApplication" ADD CONSTRAINT "EmployeeApplication_shopId_serverId_fkey" FOREIGN KEY ("shopId", "serverId") REFERENCES "Shop"("id", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopMenu" ADD CONSTRAINT "ShopMenu_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopMenu" ADD CONSTRAINT "ShopMenu_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_shopId_serverId_fkey" FOREIGN KEY ("shopId", "serverId") REFERENCES "Shop"("id", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_handlerId_fkey" FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderEvent" ADD CONSTRAINT "ShopOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
