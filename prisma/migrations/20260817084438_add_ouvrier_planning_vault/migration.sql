-- CreateEnum
CREATE TYPE "AccessCategory" AS ENUM ('COMMERCIAL', 'OUVRIER');

-- CreateEnum
CREATE TYPE "ChantierStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VaultDocumentCategory" AS ENUM ('PAYSLIP', 'DOCUMENT');

-- AlterTable
ALTER TABLE "UserCrmAccess" ADD COLUMN     "category" "AccessCategory" NOT NULL DEFAULT 'COMMERCIAL';

-- CreateTable
CREATE TABLE "Chantier" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0891b2',
    "status" "ChantierStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chantier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChantierAssignment" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChantierAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultDocument" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "category" "VaultDocumentCategory" NOT NULL DEFAULT 'DOCUMENT',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chantier_crmId_startDate_idx" ON "Chantier"("crmId", "startDate");

-- CreateIndex
CREATE INDEX "ChantierAssignment_userId_idx" ON "ChantierAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChantierAssignment_chantierId_userId_key" ON "ChantierAssignment"("chantierId", "userId");

-- CreateIndex
CREATE INDEX "VaultDocument_crmId_userId_idx" ON "VaultDocument"("crmId", "userId");

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChantierAssignment" ADD CONSTRAINT "ChantierAssignment_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChantierAssignment" ADD CONSTRAINT "ChantierAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
