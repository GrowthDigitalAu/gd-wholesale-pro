-- CreateTable
CREATE TABLE "WholesaleGroup" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerTag" TEXT NOT NULL,
    "description" TEXT,
    "pricingMethod" TEXT NOT NULL DEFAULT 'MANUAL',
    "discountValue" DOUBLE PRECISION,
    "minimumOrder" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleGroup_shop_customerTag_key" ON "WholesaleGroup"("shop", "customerTag");
