-- AlterTable
ALTER TABLE "VaultDocument" ADD COLUMN     "chantierId" TEXT,
ADD COLUMN     "foremanId" TEXT;

-- CreateIndex
CREATE INDEX "VaultDocument_foremanId_idx" ON "VaultDocument"("foremanId");

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
