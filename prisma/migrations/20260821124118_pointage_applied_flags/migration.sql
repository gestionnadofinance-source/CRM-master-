/*
  Warnings:

  - You are about to drop the column `dinnerAllowance` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `lunchAllowance` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `managementBonus` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `maskBonus` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `postBonus` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `travelAllowance` on the `Pointage` table. All the data in the column will be lost.
  - You are about to drop the column `zoneBonus` on the `Pointage` table. All the data in the column will be lost.

*/
-- AlterTable: ajoute les cases à cocher
ALTER TABLE "Pointage"
ADD COLUMN     "dinnerAllowanceApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kmReimbursementApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lunchAllowanceApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "managementBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maskBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "postBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "travelAllowanceApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "travelHoursReimbursementApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zoneBonusApplied" BOOLEAN NOT NULL DEFAULT false;

-- Préserve l'intention des fiches déjà saisies : un montant strictement
-- positif devient une case cochée, avant de perdre le montant lui-même.
-- Approximatif par nature (le montant exact n'est plus consultable une
-- fois la fiche modifiée : il redeviendra celui, actuel, du chantier) mais
-- préférable à tout décocher silencieusement sur des fiches existantes.
UPDATE "Pointage" SET
  "lunchAllowanceApplied" = ("lunchAllowance" > 0),
  "dinnerAllowanceApplied" = ("dinnerAllowance" > 0),
  "travelAllowanceApplied" = ("travelAllowance" > 0),
  "maskBonusApplied" = ("maskBonus" > 0),
  "managementBonusApplied" = ("managementBonus" > 0),
  "zoneBonusApplied" = ("zoneBonus" > 0),
  "postBonusApplied" = ("postBonus" > 0);

-- AlterTable: retire les anciens montants, remplacés par les cases ci-dessus
ALTER TABLE "Pointage" DROP COLUMN "dinnerAllowance",
DROP COLUMN "lunchAllowance",
DROP COLUMN "managementBonus",
DROP COLUMN "maskBonus",
DROP COLUMN "postBonus",
DROP COLUMN "travelAllowance",
DROP COLUMN "zoneBonus";

-- Les indemnités repas/déplacement de CrmPointageSettings ne servaient
-- qu'à préremplir une fiche jamais saisie ; elles sont remplacées par les
-- montants fixes du chantier (voir Chantier), donc obsolètes.
ALTER TABLE "CrmPointageSettings" DROP COLUMN "dinnerAllowance",
DROP COLUMN "lunchAllowance",
DROP COLUMN "travelAllowance";
