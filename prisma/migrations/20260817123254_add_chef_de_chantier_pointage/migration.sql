-- CreateEnum
CREATE TYPE "ChantierAssignmentRole" AS ENUM ('WORKER', 'FOREMAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VaultDocumentCategory" ADD VALUE 'TIMESHEET_EMPLOYEE';
ALTER TYPE "VaultDocumentCategory" ADD VALUE 'TIMESHEET_CLIENT';

-- AlterTable
ALTER TABLE "ChantierAssignment" ADD COLUMN     "role" "ChantierAssignmentRole" NOT NULL DEFAULT 'WORKER';

-- AlterTable
ALTER TABLE "UserCrmAccess" ADD COLUMN     "defaultDirtAllowance" DECIMAL(8,2) NOT NULL DEFAULT 5,
ADD COLUMN     "defaultHousingAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "defaultManagementBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "defaultMaskBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "defaultPostBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "defaultZoneBonus" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VaultDocument" ADD COLUMN     "folder" TEXT;

-- CreateTable
CREATE TABLE "CrmPointageSettings" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "nightHourlyRate" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "lunchAllowance" DECIMAL(8,2) NOT NULL DEFAULT 20,
    "dinnerAllowance" DECIMAL(8,2) NOT NULL DEFAULT 20,
    "travelAllowance" DECIMAL(8,2) NOT NULL DEFAULT 50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPointageSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pointage" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "foremanId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "days" JSONB NOT NULL,
    "housingAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "dirtAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "managementBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "zoneBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "maskBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "postBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmPointageSettings_crmId_key" ON "CrmPointageSettings"("crmId");

-- CreateIndex
CREATE INDEX "Pointage_crmId_weekStart_idx" ON "Pointage"("crmId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "Pointage_chantierId_employeeId_weekStart_key" ON "Pointage"("chantierId", "employeeId", "weekStart");

-- AddForeignKey
ALTER TABLE "CrmPointageSettings" ADD CONSTRAINT "CrmPointageSettings_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
