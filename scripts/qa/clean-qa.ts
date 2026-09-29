/**
 * Supprime tout ce que les campagnes QA ont créé dans la base LOCALE :
 * comptes @qa.local, leurs sessions, les clés API émises à leur nom, les
 * documents de coffre-fort qu'ils possèdent ou ont déposés (fichiers sur
 * disque compris), les chantiers « QA- » et tout ce qui en dépend.
 *
 * L'ORDRE COMPTE. Plusieurs relations sont en Restrict et non en Cascade :
 * VaultDocument.uploadedById et ApiKey.createdById empêchent la suppression
 * d'un compte tant qu'ils pointent vers lui. Supprimer les comptes en
 * premier échoue donc, sans rien nettoyer du tout.
 *
 * Ne touche à rien d'autre : les espaces, leurs paramètres et les comptes
 * réels sont laissés intacts. Le journal d'activité n'est pas purgé ici — il
 * se vide de lui-même après 12 mois (voir purgeOldActivityLogs).
 */
import "dotenv/config";
import { rm } from "fs/promises";
import path from "path";
import { createScriptPrismaClient } from "../../prisma/client";

/** Chemin réel d'un document, pour le stockage local (STORAGE_DRIVER=local). */
function cheminLocal(storageKey: string): string | null {
  if ((process.env.STORAGE_DRIVER ?? "local") !== "local") return null;
  const racine = process.env.STORAGE_LOCAL_PATH ?? "./storage/uploads";
  const resolu = path.resolve(racine, storageKey);
  // Filet de sécurité : ne jamais sortir de la racine de stockage, quelle que
  // soit la clé lue en base.
  return resolu.startsWith(path.resolve(racine)) ? resolu : null;
}

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();

  const comptes = await prisma.user.findMany({
    where: { email: { endsWith: "@qa.local" } },
    select: { id: true },
  });
  const userIds = comptes.map((u) => u.id);
  if (userIds.length === 0) {
    console.log("Aucun compte @qa.local : rien à nettoyer.");
    await prisma.$disconnect();
    return;
  }

  // 1. Clés API émises au nom d'un compte QA (Restrict sur createdById).
  const cles = await prisma.apiKey.deleteMany({ where: { createdById: { in: userIds } } });

  // 2. Documents de coffre-fort possédés OU déposés par un compte QA
  //    (Restrict sur uploadedById), fichiers sur disque compris.
  const documents = await prisma.vaultDocument.findMany({
    where: { OR: [{ userId: { in: userIds } }, { uploadedById: { in: userIds } }] },
    select: { id: true, storageKey: true },
  });
  let fichiersSupprimes = 0;
  for (const doc of documents) {
    const chemin = cheminLocal(doc.storageKey);
    if (!chemin) continue;
    await rm(chemin, { force: true });
    fichiersSupprimes++;
  }
  const docs = await prisma.vaultDocument.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });

  // 3. Dossiers de coffre-fort (Restrict sur createdById).
  const dossiers = await prisma.vaultFolder.deleteMany({
    where: { OR: [{ ownerUserId: { in: userIds } }, { createdById: { in: userIds } }] },
  });

  // 4. Chantiers de campagne : emportent en cascade affectations et pointages.
  const chantiers = await prisma.chantier.deleteMany({ where: { name: { startsWith: "QA" } } });

  // 5. Acomptes et absences (Restrict sur createdById).
  const acomptes = await prisma.acompte.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { createdById: { in: userIds } }] },
  });
  const absences = await prisma.absence.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { createdById: { in: userIds } }] },
  });

  // 6. Les comptes eux-mêmes, qui emportent sessions et accès.
  const supprimes = await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(
    [
      `comptes      : ${supprimes.count}`,
      `clés API     : ${cles.count}`,
      `documents    : ${docs.count} (${fichiersSupprimes} fichier(s) effacé(s))`,
      `dossiers     : ${dossiers.count}`,
      `chantiers    : ${chantiers.count}`,
      `acomptes     : ${acomptes.count}`,
      `absences     : ${absences.count}`,
    ].join("\n")
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
