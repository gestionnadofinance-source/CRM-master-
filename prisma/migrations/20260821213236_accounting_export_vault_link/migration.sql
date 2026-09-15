-- AlterEnum
ALTER TYPE "VaultDocumentCategory" ADD VALUE 'ACCOUNTING_EXPORT';

-- AlterTable
ALTER TABLE "VaultDocument" ADD COLUMN     "pointageId" TEXT;

-- CreateIndex
CREATE INDEX "VaultDocument_pointageId_idx" ON "VaultDocument"("pointageId");

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_pointageId_fkey" FOREIGN KEY ("pointageId") REFERENCES "Pointage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
