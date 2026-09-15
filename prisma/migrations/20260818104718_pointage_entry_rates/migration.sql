-- AlterTable
ALTER TABLE "Pointage" ADD COLUMN     "dinnerAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lunchAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nightHourlyRate" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "travelAllowance" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- Ces taux étaient jusqu'ici appliqués silencieusement à toutes les fiches
-- depuis les réglages communs du CRM (CrmPointageSettings), recalculés à la
-- volée à chaque affichage/export sans jamais être stockés sur la fiche.
-- On les fige ici sur chaque fiche déjà saisie avec la valeur réellement en
-- vigueur pour son CRM au moment de la migration, pour ne pas effacer
-- rétroactivement les indemnités des semaines déjà enregistrées.
UPDATE "Pointage" p
SET "nightHourlyRate" = s."nightHourlyRate",
    "lunchAllowance" = s."lunchAllowance",
    "dinnerAllowance" = s."dinnerAllowance",
    "travelAllowance" = s."travelAllowance"
FROM "CrmPointageSettings" s
WHERE s."crmId" = p."crmId";
