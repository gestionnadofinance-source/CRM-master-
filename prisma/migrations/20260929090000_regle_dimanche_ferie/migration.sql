-- Règle applicable à une heure travaillée un dimanche qui est aussi férié.
-- Sans ce réglage, ces heures alimentaient les deux rubriques et Silae
-- appliquait deux majorations sans rien signaler.
CREATE TYPE "SundayHolidayRule" AS ENUM ('CUMUL', 'FERIE_PRIORITAIRE', 'DIMANCHE_PRIORITAIRE');

-- Défaut volontairement différent du comportement historique : le cumul est
-- précisément le défaut constaté. Les espaces existants basculent donc sur
-- « férié prioritaire », seul choix qui ne paie pas deux fois par
-- inadvertance ; le cumul reste sélectionnable dans les paramètres.
ALTER TABLE "CrmPointageSettings"
  ADD COLUMN "sundayHolidayRule" "SundayHolidayRule" NOT NULL DEFAULT 'FERIE_PRIORITAIRE';
