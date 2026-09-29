import "server-only";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { logActivity } from "@/server/activity";
import { publishToUser } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { VaultDocumentCategory } from "@prisma/client";
import { findOrCreateRootFolder } from "@/server/vault/actions";
import { renderMissionOrderPdf } from "@/server/mission-order/pdf";
import { loadMissionOrderData } from "@/server/mission-order/data";

/**
 * Cœur du dépôt d'ordre de mission, SANS contrôle d'accès.
 *
 * Vit hors du module "use server" à dessein : dans un tel module, tout export
 * devient une action appelable depuis le navigateur avec des arguments
 * arbitraires. Une fonction qui ne vérifie pas les droits n'a donc rien à y
 * faire — voir src/server/vault/core.ts, même raison.
 *
 * L'appelant DOIT avoir vérifié l'accès à l'espace avant d'appeler ceci.
 */
export interface MissionOrderResult {
  ok: boolean;
  error?: string;
}

const MISSION_ORDER_FOLDER_NAME = "Ordre de mission";

/**
 * Cœur du dépôt, sans contrôle d'accès : l'appelant l'a déjà fait.
 *
 * Remplace l'ordre de mission précédent du même salarié sur le même chantier
 * au lieu d'en empiler un second. L'ordre de mission recopie les données de
 * l'affectation (adresse, kilomètres, nature de la mission) : dès qu'elles
 * changent, l'ancien exemplaire est faux, et laisser les deux dans le
 * coffre-fort revient à laisser le salarié choisir lequel croire.
 */
export async function depositMissionOrderCore(
  tenant: { crmId: string; crmSlug: string },
  actorUserId: string,
  chantierId: string,
  chantierName: string,
  employeeId: string
): Promise<MissionOrderResult> {
  const data = await loadMissionOrderData(chantierId, employeeId);
  if (!data) return { ok: false, error: "Ce salarié n'est pas affecté à ce chantier." };

  const precedents = await prisma.vaultDocument.findMany({
    where: { crmId: tenant.crmId, userId: employeeId, chantierId, category: VaultDocumentCategory.MISSION_ORDER },
    select: { id: true, storageKey: true },
  });

  const buffer = await renderMissionOrderPdf(data);
  const fileName = `Ordre de mission - ${data.employeeName} - ${chantierName}.pdf`;
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({ buffer, fileName, crmId: tenant.crmId, mimeType: "application/pdf" });
  const folderId = await findOrCreateRootFolder(tenant.crmId, employeeId, MISSION_ORDER_FOLDER_NAME, actorUserId);

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
      // Le chantier de l'ordre de mission : le coffre-fort regroupe cet
      // onglet par chantier, et le nom du fichier n'est pas une donnée.
      chantierId,
      uploadedById: actorUserId,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: actorUserId,
    action: "mission_order.deposited",
    entityType: "VAULT_DOCUMENT",
    entityId: doc.id,
    newValue: { chantierId, forUserId: employeeId },
  });
  await prisma.notification.create({
    data: {
      crmId: tenant.crmId,
      userId: employeeId,
      actorId: actorUserId,
      type: "DOCUMENT_ADDED",
      title: "Nouvel ordre de mission disponible",
      body: chantierName,
      entityType: "VAULT_DOCUMENT",
      entityId: doc.id,
    },
  });
  await publishToUser(employeeId, "notification.created", { kind: "vault_document" });

  // Le remplacement se fait APRÈS la création du nouveau : si le rendu du PDF
  // échoue, le salarié garde l'ancien plutôt que de se retrouver sans rien.
  if (precedents.length > 0) {
    await prisma.vaultDocument.deleteMany({ where: { id: { in: precedents.map((d) => d.id) } } });
    for (const ancien of precedents) {
      await driver.remove(ancien.storageKey).catch(() => undefined);
    }
  }

  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath(`/c/${tenant.crmSlug}/planning`);
  return { ok: true };
}
