import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { removeStorageKeys } from "@/lib/storage";

/**
 * Nettoyage : suppression de tous les comptes sauf celui de l'administrateur
 * qui le lance, avec tout ce qui leur appartient.
 *
 * Supprimé en cascade avec chaque compte : accès aux espaces, affectations,
 * pointages (dont il est le salarié), coffre-fort (dossiers, documents ET
 * fichiers dans le stockage), acomptes, absences, notifications, sessions,
 * compte Gmail relié. Les clés d'API qu'il a créées sont supprimées : elles
 * agissent en son nom.
 *
 * Réattribué au compte conservé, pour que rien ne bloque ni ne se perde de
 * ce qui reste : chantiers créés, fiches pointées comme chef de chantier,
 * documents déposés et dossiers créés dans le coffre-fort du compte conservé,
 * acomptes et absences saisis.
 *
 * Conservés : chantiers, réglages des espaces, correspondances Silae, et le
 * journal d'activité — dont les lignes des comptes supprimés ne sont plus
 * rattachées à personne (la base le fait d'elle-même).
 */

export interface PurgeSummary {
  deletedUsers: number;
  deletedEmails: string[];
  removedFiles: number;
}

/** Comptes visés par le nettoyage : tous, sauf celui qu'on garde. */
export function purgeTargets(keepUserId: string): Prisma.UserWhereInput {
  return { id: { not: keepUserId } };
}

export async function purgeUsersCore(keepUserId: string, targets: Prisma.UserWhereInput): Promise<PurgeSummary> {
  // Garde-fou : le compte conservé n'est jamais visé, quel que soit le filtre.
  const victims = await prisma.user.findMany({
    where: { AND: [targets, { id: { not: keepUserId } }] },
    select: { id: true, email: true },
  });
  if (victims.length === 0) return { deletedUsers: 0, deletedEmails: [], removedFiles: 0 };
  const ids = victims.map((v) => v.id);
  const inIds = { in: ids };

  // Les fichiers des coffres-forts supprimés : relevés AVANT, effacés APRÈS la
  // transaction — un échec en base ne doit pas avoir détruit de fichier.
  const files = await prisma.vaultDocument.findMany({ where: { userId: inIds }, select: { storageKey: true } });

  await prisma.$transaction([
    prisma.chantier.updateMany({ where: { createdById: inIds }, data: { createdById: keepUserId } }),
    prisma.pointage.updateMany({ where: { foremanId: inIds }, data: { foremanId: keepUserId } }),
    prisma.vaultDocument.updateMany({ where: { uploadedById: inIds }, data: { uploadedById: keepUserId } }),
    prisma.vaultFolder.updateMany({ where: { createdById: inIds }, data: { createdById: keepUserId } }),
    prisma.acompte.updateMany({ where: { createdById: inIds }, data: { createdById: keepUserId } }),
    prisma.absence.updateMany({ where: { createdById: inIds }, data: { createdById: keepUserId } }),
    prisma.apiKey.deleteMany({ where: { createdById: inIds } }),
    prisma.user.deleteMany({ where: { id: inIds } }),
  ]);

  await removeStorageKeys(files.map((f) => f.storageKey));

  return { deletedUsers: victims.length, deletedEmails: victims.map((v) => v.email), removedFiles: files.length };
}
