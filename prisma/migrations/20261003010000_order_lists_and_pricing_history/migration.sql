CREATE TABLE "SavedOrderList" (
  "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedOrderList_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedOrderList_shop_customerId_name_key" ON "SavedOrderList"("shop", "customerId", "name");
CREATE INDEX "SavedOrderList_shop_customerId_idx" ON "SavedOrderList"("shop", "customerId");
CREATE TABLE "PricingAudit" (
  "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "actor" TEXT NOT NULL,
  "source" TEXT NOT NULL, "variantId" TEXT NOT NULL, "field" TEXT NOT NULL,
  "beforeValue" TEXT, "afterValue" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "operationId" TEXT, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PricingAudit_shop_createdAt_idx" ON "PricingAudit"("shop", "createdAt");
CREATE INDEX "PricingAudit_shop_operationId_status_idx" ON "PricingAudit"("shop", "operationId", "status");
