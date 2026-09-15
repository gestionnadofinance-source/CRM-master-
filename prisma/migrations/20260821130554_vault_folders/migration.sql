-- CreateTable
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultFolder_crmId_ownerUserId_parentId_idx" ON "VaultFolder"("crmId", "ownerUserId", "parentId");

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_crmId_fkey" FOREIGN KEY ("crmId") REFERENCES "Crm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: nouvelle colonne, encore vide
ALTER TABLE "VaultDocument" ADD COLUMN "folderId" TEXT;

-- Convertit chaque étiquette "folder" (texte libre) déjà utilisée en un
-- vrai dossier racine, propre à chaque propriétaire de coffre-fort, avant
-- de la remplacer par folderId. createdById reprend le premier déposant
-- de ce dossier (ordre chronologique), à défaut d'un choix plus précis.
INSERT INTO "VaultFolder" ("id", "crmId", "ownerUserId", "name", "parentId", "createdById", "createdAt")
SELECT gen_random_uuid()::text, "crmId", "userId", "folder", NULL, "uploadedById", "createdAt"
FROM (
  SELECT DISTINCT ON ("crmId", "userId", "folder") "crmId", "userId", "folder", "uploadedById", "createdAt"
  FROM "VaultDocument"
  WHERE "folder" IS NOT NULL
  ORDER BY "crmId", "userId", "folder", "createdAt" ASC
) AS distinct_folders;

UPDATE "VaultDocument" d
SET "folderId" = f."id"
FROM "VaultFolder" f
WHERE f."ownerUserId" = d."userId" AND f."crmId" = d."crmId" AND f."name" = d."folder" AND f."parentId" IS NULL;

-- AlterTable: retire l'ancienne étiquette texte, remplacée par folderId
ALTER TABLE "VaultDocument" DROP COLUMN "folder";

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
