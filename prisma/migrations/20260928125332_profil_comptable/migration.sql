-- Profil « Comptable » : mêmes droits que « Secrétaire », intitulé distinct.
--
-- ALTER TYPE ... ADD VALUE ne peut pas être suivi, dans la MÊME transaction,
-- d'une requête utilisant la nouvelle valeur (PostgreSQL). Cette migration
-- se limite donc à ajouter la valeur ; aucune donnée existante n'est
-- touchée, les accès déjà en base gardent leur catégorie.
ALTER TYPE "AccessCategory" ADD VALUE 'COMPTABLE';
