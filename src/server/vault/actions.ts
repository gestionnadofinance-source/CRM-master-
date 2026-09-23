"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess, requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { getStorageDriver, MAX_UPLOAD_SIZE_BYTES, ALLOWED_MIME_TYPES } from "@/lib/storage";
import { logActivity } from "@/server/activity";
import { publishToUser } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { VaultDocumentCategory } from "@prisma/client";
import { createVaultFolderCore, moveVaultDocumentCore, moveVaultFolderCore, type ActionResult } from "@/server/vault/core";
import { CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

export type { ActionResult };

/**
 * Retrouve, ou crée, un dossier racine de ce nom dans le coffre-fort de
 * `ownerUserId`. Utilisé par les dépôts automatiques (fiches de pointage,
 * ordre de mission) qui n'ont pas de contexte de permission MANAGE_SETTINGS
 * — l'appelant est responsable d'avoir déjà vérifié ses propres droits.
 */
export async function findOrCreateRootFolder(crmId: string, ownerUserId: string, name: string, createdById: string): Promise<string> {
  const existing = await prisma.vaultFolder.findFirst({ where: { crmId, ownerUserId, parentId: null, name } });
  if (existing) return existing.id;
  const created = await prisma.vaultFolder.create({ data: { crmId, ownerUserId, name, parentId: null, createdById } });
  return created.id;
}

/**
 * Ce que le coffre-fort a besoin de savoir d'un document pour l'afficher et le
 * classer. `chantier` et `periodStart` portent les regroupements par chantier
 * et par mois (voir VaultDocument dans prisma/schema.prisma) ; ils sont nuls
 * sur les documents qui n'ont pas de période ou de chantier — fiche de paie,
 * document libre — et sur ceux déposés avant l'ajout de ces champs.
 */
const VAULT_DOCUMENT_SHAPE = {
  uploadedBy: { select: { firstName: true, lastName: true } },
  chantier: { select: { id: true, name: true } },
} as const;

/** Le coffre-fort d'un utilisateur ne lui est visible qu'à lui-même (et aux administrateurs du CRM). */
export async function listMyVaultDocuments(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  return prisma.vaultDocument.findMany({
    where: { crmId: tenant.crmId, userId: ctx.user.id },
    // periodStart d'abord : dans un onglet regroupé par mois, les fiches se
    // lisent de la plus récente à la plus ancienne selon la semaine couverte,
    // pas selon la date de dépôt. createdAt départage celles sans période.
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    include: VAULT_DOCUMENT_SHAPE,
  });
}

/** Liste plate des dossiers d'un coffre-fort — le client reconstruit l'arborescence via parentId. */
export async function listMyVaultFolders(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  return prisma.vaultFolder.findMany({
    where: { crmId: tenant.crmId, ownerUserId: ctx.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentId: true },
  });
}

export async function listVaultFoldersForUser(crmId: string, targetUserId: string) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  const member = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
  });
  if (!member) return [];
  return prisma.vaultFolder.findMany({
    where: { crmId: tenant.crmId, ownerUserId: targetUserId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentId: true },
  });
}

const folderNameSchema = z.string().trim().min(1, "Le nom du dossier est requis.").max(150).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE);

/**
 * Créer un dossier est permis à un administrateur/secrétaire pour
 * n'importe quel coffre-fort (targetUserId quelconque), ou à un
 * utilisateur pour son propre coffre-fort (targetUserId === lui-même) —
 * voir createMyVaultFolder. Renommer/supprimer restent réservés à
 * l'administration (cf. renameVaultFolder/deleteVaultFolder) : le
 * propriétaire ne peut que créer et déplacer, jamais renommer ni
 * supprimer, à la demande explicite du client.
 */
export async function createVaultFolder(
  crmId: string,
  targetUserId: string,
  name: string,
  parentId: string | null
): Promise<ActionResult> {
  const ctx = await requireAuth();
  return createVaultFolderCore(ctx, crmId, targetUserId, name, parentId);
}

/** Créer un dossier dans son propre coffre-fort — voir createVaultFolder. */
export async function createMyVaultFolder(crmId: string, name: string, parentId: string | null): Promise<ActionResult> {
  const ctx = await requireAuth();
  return createVaultFolder(crmId, ctx.user.id, name, parentId);
}

export async function renameVaultFolder(crmId: string, folderId: string, name: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const parsedName = folderNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0]?.message ?? "Nom invalide." };

  const folder = await prisma.vaultFolder.findUnique({ where: { id: folderId } });
  if (!folder) return { ok: false, error: "Dossier introuvable." };
  assertBelongsToCrm(folder.crmId, tenant, "Dossier");

  await prisma.vaultFolder.update({ where: { id: folderId }, data: { name: parsedName.data } });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath("/admin/vault");
  return { ok: true };
}

export async function deleteVaultFolder(crmId: string, folderId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const folder = await prisma.vaultFolder.findUnique({
    where: { id: folderId },
    include: { _count: { select: { children: true, documents: true } } },
  });
  if (!folder) return { ok: false, error: "Dossier introuvable." };
  assertBelongsToCrm(folder.crmId, tenant, "Dossier");
  if (folder._count.children > 0 || folder._count.documents > 0) {
    return { ok: false, error: "Ce dossier n'est pas vide." };
  }

  await prisma.vaultFolder.delete({ where: { id: folderId } });
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
export async function moveVaultDocument(
  crmId: string,
  documentId: string,
  targetFolderId: string | null
): Promise<ActionResult> {
  const ctx = await requireAuth();
  return moveVaultDocumentCore(ctx, crmId, documentId, targetFolderId);
}

/**
 * Déplace un dossier (avec son contenu) vers un autre dossier du même
 * coffre-fort, ou à la racine. Mêmes droits que moveVaultDocument.
 * Refuse tout déplacement qui créerait un cycle (dans lui-même ou dans
 * l'un de ses propres descendants).
 */
export async function moveVaultFolder(
  crmId: string,
  folderId: string,
  targetParentId: string | null
): Promise<ActionResult> {
  const ctx = await requireAuth();
  return moveVaultFolderCore(ctx, crmId, folderId, targetParentId);
}

/** Liste des membres du CRM dont un administrateur peut gérer le coffre-fort. */
export async function listVaultMembers(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  const access = await prisma.userCrmAccess.findMany({
    where: { crmId: tenant.crmId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, color: true, status: true } },
    },
    orderBy: { user: { firstName: "asc" } },
  });
  const counts = await prisma.vaultDocument.groupBy({
    by: ["userId"],
    where: { crmId: tenant.crmId },
    _count: { _all: true },
  });
  const countByUser = new Map(counts.map((c) => [c.userId, c._count._all]));
  return access
    .filter((a) => a.user.status === "ACTIVE")
    .map((a) => ({ ...a.user, category: a.category, documentCount: countByUser.get(a.user.id) ?? 0 }));
}

export async function listVaultDocumentsForUser(crmId: string, targetUserId: string) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  const member = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
  });
  if (!member) return [];
  return prisma.vaultDocument.findMany({
    where: { crmId: tenant.crmId, userId: targetUserId },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    include: VAULT_DOCUMENT_SHAPE,
  });
}

export async function uploadVaultDocument(
  crmId: string,
  targetUserId: string,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const member = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
  });
  if (!member) return { ok: false, error: "Cette personne n'a pas accès à ce CRM." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Aucun fichier fourni." };
  if (file.size > MAX_UPLOAD_SIZE_BYTES) return { ok: false, error: "Fichier trop volumineux (20 Mo maximum)." };
  // Un type MIME vide (trivial à forger) ne doit jamais contourner la
  // liste blanche : on rejette explicitement plutôt que de laisser passer.
  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) return { ok: false, error: "Type de fichier non autorisé." };

  const categoryRaw = String(formData.get("category") ?? "DOCUMENT");
  const category: VaultDocumentCategory = categoryRaw === "PAYSLIP" ? "PAYSLIP" : "DOCUMENT";

  const folderIdRaw = formData.get("folderId");
  const folderId = typeof folderIdRaw === "string" && folderIdRaw ? folderIdRaw : null;
  if (folderId) {
    const folder = await prisma.vaultFolder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerUserId !== targetUserId || folder.crmId !== tenant.crmId) {
      return { ok: false, error: "Dossier introuvable." };
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({
    buffer,
    fileName: file.name,
    crmId: tenant.crmId,
    mimeType: file.type || "application/octet-stream",
  });

  const doc = await prisma.vaultDocument.create({
    data: {
      crmId: tenant.crmId,
      userId: targetUserId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storageKey,
      category,
      folderId,
      uploadedById: ctx.user.id,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "vault.document_added",
    entityType: "VAULT_DOCUMENT",
    entityId: doc.id,
    newValue: { fileName: file.name, forUserId: targetUserId },
  });
  await prisma.notification.create({
    data: {
      crmId: tenant.crmId,
      userId: targetUserId,
      actorId: ctx.user.id,
      type: "DOCUMENT_ADDED",
      title: category === "PAYSLIP" ? "Nouvelle fiche de paie disponible" : "Nouveau document disponible",
      body: file.name,
      entityType: "VAULT_DOCUMENT",
      entityId: doc.id,
    },
  });
  await publishToUser(targetUserId, "notification.created", { kind: "vault_document" });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  return { ok: true };
}

export async function deleteVaultDocument(crmId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const doc = await prisma.vaultDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { ok: false, error: "Document introuvable." };
  assertBelongsToCrm(doc.crmId, tenant, "Document");

  await getStorageDriver().remove(doc.storageKey);
  await prisma.vaultDocument.delete({ where: { id: documentId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "vault.document_deleted",
    entityType: "VAULT_DOCUMENT",
    entityId: documentId,
    oldValue: { fileName: doc.fileName, forUserId: doc.userId },
  });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  return { ok: true };
}
