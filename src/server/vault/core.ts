import "server-only";

// Logique testable des actions de coffre-fort les plus sensibles (création,
// déplacement de fichiers/dossiers) — extraite de vault/actions.ts ("use
// server") dans ce module ordinaire pour pouvoir être appelée directement
// depuis les tests d'intégration (tests/vault.test.ts) sans passer par
// requireAuth()/next-headers, indisponible hors d'une vraie requête Next.
// Les wrappers "use server" de vault/actions.ts se contentent de résoudre
// le AuthContext (requireAuth()) puis de déléguer ici : le comportement et
// la surface publique de ces actions restent strictement inchangés.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/server/auth/session";
import { requireCrmAccess, canManageOperations, assertBelongsToCrm } from "@/server/tenant";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const folderNameSchema = z.string().trim().min(1, "Le nom du dossier est requis.").max(150);

/**
 * Créer un dossier est permis à un administrateur/secrétaire pour
 * n'importe quel coffre-fort (targetUserId quelconque), ou à un
 * utilisateur pour son propre coffre-fort (targetUserId === lui-même).
 * Renommer/supprimer restent réservés à l'administration : le propriétaire
 * ne peut que créer et déplacer, jamais renommer ni supprimer, à la
 * demande explicite du client.
 */
export async function createVaultFolderCore(
  ctx: AuthContext,
  crmId: string,
  targetUserId: string,
  name: string,
  parentId: string | null
): Promise<ActionResult> {
  const tenant = await requireCrmAccess(ctx, crmId);
  const isSelf = targetUserId === ctx.user.id;
  if (!isSelf && !canManageOperations(tenant)) {
    return { ok: false, error: "Permission insuffisante pour cette action." };
  }
  // Le contrôle d'accès au CRM cible a déjà été fait par requireCrmAccess
  // ci-dessus (y compris pour un administrateur global, dont l'accès est
  // synthétique et n'a donc pas de ligne UserCrmAccess) : cette recherche ne
  // sert qu'à valider qu'une AUTRE personne (le cas admin/secrétaire gérant
  // un tiers) appartient bien à ce CRM.
  if (!isSelf) {
    const member = await prisma.userCrmAccess.findUnique({
      where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
    });
    if (!member) return { ok: false, error: "Cette personne n'a pas accès à ce CRM." };
  }

  const parsedName = folderNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0]?.message ?? "Nom invalide." };

  if (parentId) {
    const parent = await prisma.vaultFolder.findUnique({ where: { id: parentId } });
    if (!parent || parent.ownerUserId !== targetUserId || parent.crmId !== tenant.crmId) {
      return { ok: false, error: "Dossier parent introuvable." };
    }
  }

  await prisma.vaultFolder.create({
    data: { crmId: tenant.crmId, ownerUserId: targetUserId, name: parsedName.data, parentId, createdById: ctx.user.id },
  });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath("/admin/vault");
  return { ok: true };
}

/**
 * Déplace un document vers un autre dossier du même coffre-fort (ou à la
 * racine si targetFolderId est null). Permis au propriétaire du document
 * pour son propre coffre-fort, ou à un administrateur/secrétaire pour
 * n'importe quel coffre-fort — jamais vers le coffre-fort de quelqu'un
 * d'autre.
 */
export async function moveVaultDocumentCore(
  ctx: AuthContext,
  crmId: string,
  documentId: string,
  targetFolderId: string | null
): Promise<ActionResult> {
  const tenant = await requireCrmAccess(ctx, crmId);

  const doc = await prisma.vaultDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { ok: false, error: "Document introuvable." };
  assertBelongsToCrm(doc.crmId, tenant, "Document");
  if (doc.userId !== ctx.user.id && !canManageOperations(tenant)) {
    return { ok: false, error: "Permission insuffisante pour cette action." };
  }

  if (targetFolderId) {
    const folder = await prisma.vaultFolder.findUnique({ where: { id: targetFolderId } });
    if (!folder || folder.ownerUserId !== doc.userId || folder.crmId !== tenant.crmId) {
      return { ok: false, error: "Dossier de destination introuvable." };
    }
  }

  await prisma.vaultDocument.update({ where: { id: documentId }, data: { folderId: targetFolderId } });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath("/admin/vault");
  return { ok: true };
}

/**
 * Déplace un dossier (avec son contenu) vers un autre dossier du même
 * coffre-fort, ou à la racine. Mêmes droits que moveVaultDocumentCore.
 * Refuse tout déplacement qui créerait un cycle (dans lui-même ou dans
 * l'un de ses propres descendants).
 */
export async function moveVaultFolderCore(
  ctx: AuthContext,
  crmId: string,
  folderId: string,
  targetParentId: string | null
): Promise<ActionResult> {
  const tenant = await requireCrmAccess(ctx, crmId);

  const folder = await prisma.vaultFolder.findUnique({ where: { id: folderId } });
  if (!folder) return { ok: false, error: "Dossier introuvable." };
  assertBelongsToCrm(folder.crmId, tenant, "Dossier");
  if (folder.ownerUserId !== ctx.user.id && !canManageOperations(tenant)) {
    return { ok: false, error: "Permission insuffisante pour cette action." };
  }

  if (targetParentId === folderId) {
    return { ok: false, error: "Un dossier ne peut pas être déplacé dans lui-même." };
  }

  if (targetParentId) {
    const target = await prisma.vaultFolder.findUnique({ where: { id: targetParentId } });
    if (!target || target.ownerUserId !== folder.ownerUserId || target.crmId !== tenant.crmId) {
      return { ok: false, error: "Dossier de destination introuvable." };
    }
    let cursor: string | null = target.parentId;
    while (cursor) {
      if (cursor === folderId) {
        return { ok: false, error: "Impossible de déplacer un dossier dans l'un de ses sous-dossiers." };
      }
      const parent: { parentId: string | null } | null = await prisma.vaultFolder.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  await prisma.vaultFolder.update({ where: { id: folderId }, data: { parentId: targetParentId } });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath("/admin/vault");
  return { ok: true };
}
