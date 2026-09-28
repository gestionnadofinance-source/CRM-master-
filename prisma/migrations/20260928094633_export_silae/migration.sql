-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('CONGE_PAYE', 'MALADIE', 'ABSENCE_INJUSTIFIEE', 'REPOS_COMPENSATEUR', 'ACCIDENT_TRAVAIL', 'CONGE_SANS_SOLDE', 'AUTRE');

-- AlterTable
ALTER TABLE "Pointage" ADD COLUMN     "gdDepl53Count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gdDepl80Count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserCrmAccess" ADD COLUMN     "silaeMatricule" TEXT;

-- CreateTable
CREATE TABLE "SilaeCodeMapping" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "rubrique" TEXT NOT NULL,
    "silaeCode" TEXT NOT NULL DEFAULT '',
    "multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "exported" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SilaeCodeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acompte" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "payrollMonth" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Acompte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(6,2),
    "days" DECIMAL(5,2),
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SilaeCodeMapping_crmId_idx" ON "SilaeCodeMapping"("crmId");

-- CreateIndex
CREATE UNIQUE INDEX "SilaeCodeMapping_crmId_rubrique_key" ON "SilaeCodeMapping"("crmId", "rubrique");

-- CreateIndex
CREATE INDEX "Acompte_crmId_payrollMonth_idx" ON "Acompte"("crmId", "payrollMonth");

-- CreateIndex
CREATE INDEX "Acompte_userId_idx" ON "Acompte"("userId");

-- CreateIndex
CREATE INDEX "Absence_crmId_startDate_idx" ON "Absence"("crmId", "startDate");

-- CreateIndex
CREATE INDEX "Absence_userId_idx" ON "Absence"("userId");

-- AddForeignKey
ALTER TABLE "SilaeCodeMapping" ADD CONSTRAINT "SilaeCodeMapping_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acompte" ADD CONSTRAINT "Acompte_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acompte" ADD CONSTRAINT "Acompte_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acompte" ADD CONSTRAINT "Acompte_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

