-- Règles du formulaire de pointage (octobre 2026).
--
-- Repas midi / soir : le chef de chantier choisit le NOMBRE de repas de la
-- semaine. NULL sur les fiches existantes = un repas par jour travaillé, soit
-- exactement ce qui était calculé jusqu'ici : rien ne change pour l'historique.
ALTER TABLE "Pointage" ADD COLUMN "lunchCount" INTEGER;
ALTER TABLE "Pointage" ADD COLUMN "dinnerCount" INTEGER;

-- Salissure : une unité par semaine, cochée, et non plus un montant en euros.
-- Une fiche existante portant un montant reste une semaine avec salissure.
ALTER TABLE "Pointage" ADD COLUMN "dirtAllowanceApplied" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Pointage" SET "dirtAllowanceApplied" = true WHERE "dirtAllowance" > 0;
