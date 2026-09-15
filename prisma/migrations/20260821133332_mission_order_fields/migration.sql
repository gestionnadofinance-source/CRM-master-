-- AlterEnum
ALTER TYPE "VaultDocumentCategory" ADD VALUE 'MISSION_ORDER';

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "ape" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "legalRepresentative" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "missionOrderLegalMentions" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "urssafOffice" TEXT NOT NULL DEFAULT '';
