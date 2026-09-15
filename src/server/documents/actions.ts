"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { getStorageDriver, MAX_UPLOAD_SIZE_BYTES, ALLOWED_MIME_TYPES } from "@/lib/storage";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { Permission } from "@/server/permissions";
import { DocumentEntity } from "@prisma/client";

const ENTITY_FIELD: Record<DocumentEntity, "clientId" | "prospectId" | "quoteId" | "appointmentId" | null> = {
  CLIENT: "clientId",
  PROSPECT: "prospectId",
  QUOTE: "quoteId",
  APPOINTMENT: "appointmentId",
  MESSAGE: null,
};

export interface UploadDocumentResult {
  ok: boolean;
  error?: string;
  documentId?: string;
}

export async function uploadDocument(
  crmId: string,
  entityType: DocumentEntity,
  entityId: string,
  formData: FormData
): Promise<UploadDocumentResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.CREATE);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Aucun fichier fourni." };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return { ok: false, error: "Fichier trop volumineux (20 Mo maximum)." };
  }
  // Un type MIME vide (trivial à forger dans une requête multipart) ne
  // doit jamais contourner la liste blanche — on rejette explicitement,
  // on ne retombe jamais sur application/octet-stream par défaut.
  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, error: "Type de fichier non autorisé." };
  }

  await assertEntityBelongsToCrm(entityType, entityId, tenant.crmId);

  const buffer = Buffer.from(await file.arrayBuffer());
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({
    buffer,
    fileName: file.name,
    crmId: tenant.crmId,
    mimeType: file.type || "application/octet-stream",
  });

  const fieldName = ENTITY_FIELD[entityType];
  const document = await prisma.document.create({
    data: {
      crmId: tenant.crmId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storageKey,
      entityType,
      entityId,
      uploadedById: ctx.user.id,
      ...(fieldName ? { [fieldName]: entityId } : {}),
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "document.created",
    entityType,
    entityId,
    newValue: { fileName: file.name },
  });
  await publishToCrm(tenant.crmId, "notification.created", { kind: "document", entityType, entityId });
  revalidatePath(`/c/${tenant.crmSlug}`);

  return { ok: true, documentId: document.id };
}

export async function listDocuments(crmId: string, entityType: DocumentEntity, entityId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  return prisma.document.findMany({
    where: { crmId: tenant.crmId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function deleteDocument(crmId: string, documentId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return { ok: false, error: "Document introuvable." };
  assertBelongsToCrm(document.crmId, tenant, "Document");

  await getStorageDriver().remove(document.storageKey);
  await prisma.document.delete({ where: { id: documentId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "document.deleted",
    entityType: document.entityType,
    entityId: document.entityId,
    oldValue: { fileName: document.fileName },
  });
  revalidatePath(`/c/${tenant.crmSlug}`);
  return { ok: true };
}

async function assertEntityBelongsToCrm(entityType: DocumentEntity, entityId: string, crmId: string): Promise<void> {
  switch (entityType) {
    case "CLIENT": {
      const row = await prisma.client.findUnique({ where: { id: entityId }, select: { crmId: true } });
      if (!row || row.crmId !== crmId) throw new Error("Client introuvable dans ce CRM.");
      return;
    }
    case "PROSPECT": {
      const row = await prisma.prospect.findUnique({ where: { id: entityId }, select: { crmId: true } });
      if (!row || row.crmId !== crmId) throw new Error("Prospect introuvable dans ce CRM.");
      return;
    }
    case "QUOTE": {
      const row = await prisma.quote.findUnique({ where: { id: entityId }, select: { crmId: true } });
      if (!row || row.crmId !== crmId) throw new Error("Devis introuvable dans ce CRM.");
      return;
    }
    case "APPOINTMENT": {
      const row = await prisma.appointment.findUnique({ where: { id: entityId }, select: { crmId: true } });
      if (!row || row.crmId !== crmId) throw new Error("Rendez-vous introuvable dans ce CRM.");
      return;
    }
    case "MESSAGE": {
      const row = await prisma.message.findUnique({ where: { id: entityId }, select: { crmId: true } });
      if (!row || row.crmId !== crmId) throw new Error("Message introuvable dans ce CRM.");
      return;
    }
  }
}
