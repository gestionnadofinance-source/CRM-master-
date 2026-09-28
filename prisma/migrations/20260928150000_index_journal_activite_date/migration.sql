-- La purge quotidienne du journal d'activité filtre sur la seule date
-- (purgeOldActivityLogs, src/server/activity.ts). Les index existants sont
-- tous préfixés par "crmId", inutilisables pour ce filtre : sans celui-ci,
-- la purge parcourt intégralement la table la plus volumineuse de la base.
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
