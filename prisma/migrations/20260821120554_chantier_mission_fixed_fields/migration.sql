-- AlterTable
ALTER TABLE "Chantier" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "dinnerAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "importantDocuments" TEXT,
ADD COLUMN     "lunchAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "managementBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "maskBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "missionNature" TEXT,
ADD COLUMN     "postBonus" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "siteContactName" TEXT,
ADD COLUMN     "siteContactPhone" TEXT,
ADD COLUMN     "travelAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "zoneBonus" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChantierAssignment" ADD COLUMN     "distanceKm" DECIMAL(8,2),
ADD COLUMN     "kmRate" DECIMAL(8,3),
ADD COLUMN     "travelDurationHours" DECIMAL(6,2),
ADD COLUMN     "travelHourlyRate" DECIMAL(8,2),
ADD COLUMN     "workerAddress" TEXT;
