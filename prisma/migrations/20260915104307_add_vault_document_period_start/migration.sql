-- AlterTable
ALTER TABLE "VaultDocument" ADD COLUMN     "periodStart" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "VaultDocument_crmId_userId_category_periodStart_idx" ON "VaultDocument"("crmId", "userId", "category", "periodStart");
