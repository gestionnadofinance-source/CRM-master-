"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { getStorageDriver } from "@/lib/storage";
import { logActivity } from "@/server/activity";
import { publishToUser } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { VaultDocumentCategory } from "@prisma/client";
import { findOrCreateRootFolder } from "@/server/vault/actions";
import { renderMissionOrderPdf } from "@/server/mission-order/pdf";
import { loadMissionOrderData } from "@/server/mission-order/data";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const MISSION_ORDER_FOLDER_NAME = "Ordre de mission";

/** Génère l'ordre de mission et le dépose dans le coffre-fort individuel du salarié. */
export async function depositMissionOrder(crmId: string, chantierId: string, employeeId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");

  const member = await prisma.userCrmAccess.findUnique({ where: { userId_crmId: { userId: employeeId, crmId: tenant.crmId } } });
  if (!member) return { ok: false, error: "Cette personne n'a pas accès à ce CRM." };

  const data = await loadMissionOrderData(chantierId, employeeId);
  if (!data) return { ok: false, error: "Ce salarié n'est pas affecté à ce chantier." };

  const buffer = await renderMissionOrderPdf(data);
  const fileName = `Ordre de mission - ${data.employeeName} - ${chantier.name}.pdf`;
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({ buffer, fileName, crmId: tenant.crmId, mimeType: "application/pdf" });
  const folderId = await findOrCreateRootFolder(tenant.crmId, employeeId, MISSION_ORDER_FOLDER_NAME, ctx.user.id);

  const doc = await prisma.vaultDocument.create({
    data: {
      crmId: tenant.crmId,
      userId: employeeId,
      fileName,
      mimeType: "application/pdf",
      size: buffer.length,
      storageKey,
      category: VaultDocumentCategory.MISSION_ORDER,
      folderId,
      uploadedById: ctx.user.id,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "mission_order.deposited",
    entityType: "VAULT_DOCUMENT",
    entityId: doc.id,
    newValue: { chantierId, forUserId: employeeId },
  });
  await prisma.notification.create({
    data: {
      crmId: tenant.crmId,
      userId: employeeId,
      actorId: ctx.user.id,
      type: "DOCUMENT_ADDED",
      title: "Nouvel ordre de mission disponible",
      body: chantier.name,
      entityType: "VAULT_DOCUMENT",
      entityId: doc.id,
    },
  });
  await publishToUser(employeeId, "notification.created", { kind: "vault_document" });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath(`/c/${tenant.crmSlug}/planning`);
  return { ok: true };
}
