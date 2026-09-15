-- AlterTable
ALTER TABLE "CrmPointageSettings" DROP COLUMN "nightHourlyRate",
ADD COLUMN     "nightRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 25;

-- AlterTable
ALTER TABLE "Pointage" DROP COLUMN "nightHourlyRate",
ADD COLUMN     "hourlyRate" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nightRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserCrmAccess" ADD COLUMN     "defaultHourlyRate" DECIMAL(8,2) NOT NULL DEFAULT 0;

