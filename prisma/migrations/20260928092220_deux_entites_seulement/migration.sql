-- Ne conserve que les deux entités exploitées : Fidem Froid Clim et Fidem
-- Maintenance. Les trois autres (Fitness Park Modge, Association, Société
-- de Communication) n'ont jamais servi et encombrent le tableau de bord,
-- le sélecteur d'espace, le Planning et le Pointage client.
--
-- SUPPRESSION CONDITIONNELLE — à lire avant de la modifier.
--
-- Supprimer un Crm cascade sur ses chantiers, pointages, coffres-forts,
-- accès utilisateurs et journal d'activité. Cette migration ne supprime
-- donc une entité QUE si elle est vérifiée vide sur chacune de ces
-- tables. Une entité qui contiendrait la moindre donnée survit : elle
-- réapparaîtra dans l'interface, ce qui est un signal visible et
-- rattrapable, là où une suppression en cascade ne le serait pas.
--
-- Le seed (prisma/seed.ts) ne crée plus que les deux entités conservées :
-- rien ne recrée les trois autres au déploiement suivant.

DELETE FROM "Crm" c
WHERE c.slug IN ('fitness-park-modge', 'association', 'societe-communication')
  AND NOT EXISTS (SELECT 1 FROM "Chantier"      x WHERE x."crmId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "Pointage"      x WHERE x."crmId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "VaultDocument" x WHERE x."crmId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "VaultFolder"   x WHERE x."crmId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "UserCrmAccess" x WHERE x."crmId" = c.id);
