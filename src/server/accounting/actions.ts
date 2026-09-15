"use server";

import { getISOWeek } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { getStorageDriver } from "@/lib/storage";
import { logActivity } from "@/server/activity";
import { revalidatePath } from "next/cache";
import { VaultDocumentCategory } from "@prisma/client";
import { findOrCreateRootFolder } from "@/server/vault/actions";
import { buildAccountingWorkbook, type AccountingWeekInput, type AccountingDay } from "@/server/accounting/xlsx";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ACCOUNTING_FOLDER_NAME = "Comptabilité";

interface AccountingPerson {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
}

export interface AccountingForemanGroup {
  /** null = tableaux sans chef de chantier identifiable (généré avant l'ajout de ce classement, ou fiches sans chef renseigné). */
  foreman: AccountingPerson | null;
  employees: (AccountingPerson & { documentCount: number })[];
}

/**
 * Tableaux de comptabilité générés, classés par chef de chantier puis par
 * salarié — un chef de chantier peut apparaître pour plusieurs salariés,
 * et un salarié peut apparaître sous plusieurs chefs s'il a été pointé sur
 * des chantiers différents. Voir /c/[crmSlug]/comptabilite et le champ
 * VaultDocument.foremanId (renseigné par generateAccountingExport).
 */
export async function listAccountingGroups(crmId: string): Promise<AccountingForemanGroup[]> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const docs = await prisma.vaultDocument.findMany({
    where: { crmId: tenant.crmId, category: VaultDocumentCategory.ACCOUNTING_EXPORT },
    select: {
      user: { select: { id: true, firstName: true, lastName: true, color: true, status: true } },
      foreman: { select: { id: true, firstName: true, lastName: true, color: true } },
    },
  });

  const groups = new Map<string, AccountingForemanGroup>();
  const employeesByGroup = new Map<string, Map<string, AccountingPerson & { documentCount: number }>>();

  for (const doc of docs) {
    if (doc.user.status !== "ACTIVE") continue;
    const key = doc.foreman?.id ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, { foreman: doc.foreman, employees: [] });
      employeesByGroup.set(key, new Map());
    }
    const employees = employeesByGroup.get(key)!;
    const existing = employees.get(doc.user.id);
    if (existing) existing.documentCount += 1;
    else employees.set(doc.user.id, { ...doc.user, documentCount: 1 });
  }

  for (const [key, group] of groups) {
    group.employees = Array.from(employeesByGroup.get(key)!.values()).sort((a, b) => a.firstName.localeCompare(b.firstName));
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (!a.foreman) return 1;
    if (!b.foreman) return -1;
    return a.foreman.firstName.localeCompare(b.foreman.firstName);
  });
}

/**
 * Tableaux de comptabilité générés pour un salarié donné, sous un chef de
 * chantier donné (`foremanId` — passer `null` explicitement pour le
 * groupe "sans chef de chantier", omettre pour ne pas filtrer).
 */
export async function listAccountingDocumentsForUser(crmId: string, targetUserId: string, foremanId?: string | null) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  const member = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
  });
  if (!member) return [];
  return prisma.vaultDocument.findMany({
    where: {
      crmId: tenant.crmId,
      userId: targetUserId,
      category: VaultDocumentCategory.ACCOUNTING_EXPORT,
      ...(foremanId !== undefined ? { foremanId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { firstName: true, lastName: true } }, chantier: { select: { name: true } } },
  });
}

function toDayArray(value: unknown): AccountingDay[] {
  if (!Array.isArray(value)) return [];
  return value.map((d) => ({
    date: String((d as Record<string, unknown>).date ?? ""),
    normal: Number((d as Record<string, unknown>).normal) || 0,
    matin: Number((d as Record<string, unknown>).matin) || 0,
    apresMidi: Number((d as Record<string, unknown>).apresMidi) || 0,
    nuit: Number((d as Record<string, unknown>).nuit) || 0,
  }));
}

/**
 * Transforme les fiches de pointage salarié sélectionnées dans le
 * coffre-fort en un tableau de comptabilité Excel, déposé dans le dossier
 * "Comptabilité" du salarié concerné. Toutes les fiches sélectionnées
 * doivent appartenir au MÊME salarié et au MÊME chantier — jamais un
 * mélange, comme demandé : voir le refus explicite ci-dessous.
 */
export async function generateAccountingExport(
  crmId: string,
  employeeId: string,
  vaultDocumentIds: string[]
): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  if (vaultDocumentIds.length === 0) {
    return { ok: false, error: "Sélectionnez au moins une fiche de pointage." };
  }

  const docs = await prisma.vaultDocument.findMany({
    where: { id: { in: vaultDocumentIds } },
    include: {
      pointage: {
        include: { chantier: true },
      },
    },
  });
  if (docs.length !== vaultDocumentIds.length) {
    return { ok: false, error: "Une ou plusieurs fiches sont introuvables." };
  }
  for (const doc of docs) {
    assertBelongsToCrm(doc.crmId, tenant, "Document");
    if (doc.category !== VaultDocumentCategory.TIMESHEET_EMPLOYEE || !doc.pointage) {
      return { ok: false, error: "Seules les fiches de pointage salarié peuvent être transformées." };
    }
    if (doc.userId !== employeeId) {
      return { ok: false, error: "Toutes les fiches sélectionnées doivent concerner le même salarié." };
    }
  }

  const chantierId = docs[0]!.pointage!.chantierId;
  if (docs.some((d) => d.pointage!.chantierId !== chantierId)) {
    return { ok: false, error: "Toutes les fiches sélectionnées doivent concerner le même chantier — jamais un mélange de chantier." };
  }

  const employee = await prisma.user.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
  if (!employee) return { ok: false, error: "Salarié introuvable." };

  const chantier = docs[0]!.pointage!.chantier;
  const assignment = await prisma.chantierAssignment.findUnique({
    where: { chantierId_userId: { chantierId, userId: employeeId } },
  });

  // Une fiche = une semaine. On dédoublonne par semaine (weekStart) au cas
  // où plusieurs documents pointeraient vers la même fiche, puis on trie
  // chronologiquement pour un export lisible.
  const pointageByWeek = new Map<string, (typeof docs)[number]["pointage"]>();
  for (const doc of docs) {
    pointageByWeek.set(doc.pointage!.weekStart.toISOString(), doc.pointage);
  }
  const sortedPointages = Array.from(pointageByWeek.values())
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

  // Chef de chantier associé à cet export, pour classer l'onglet
  // Comptabilité par chef de chantier (voir listAccountingGroups) : le
  // chef ayant déposé le plus de fiches parmi celles sélectionnées, lu
  // directement sur les fiches (jamais recalculé via les affectations,
  // qui peuvent lister plusieurs chefs potentiels ou aucun).
  const foremanCounts = new Map<string, number>();
  for (const p of sortedPointages) {
    foremanCounts.set(p.foremanId, (foremanCounts.get(p.foremanId) ?? 0) + 1);
  }
  const foremanId = Array.from(foremanCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const weeks: AccountingWeekInput[] = sortedPointages.map((p) => ({
    isoWeek: getISOWeek(p.weekStart),
    days: toDayArray(p.days),
    housingAllowance: Number(p.housingAllowance),
    lunchAllowance: p.lunchAllowanceApplied ? Number(chantier.lunchAllowance) : 0,
    dinnerAllowance: p.dinnerAllowanceApplied ? Number(chantier.dinnerAllowance) : 0,
    mealAllowance: p.mealAllowanceApplied ? Number(chantier.mealAllowance) : 0,
    managementBonus: p.managementBonusApplied ? Number(chantier.managementBonus) : 0,
    clothingBonus: p.clothingBonusApplied ? Number(chantier.clothingBonus) : 0,
    postBonus: p.postBonusApplied ? Number(chantier.postBonus) : 0,
    maskBonus: p.maskBonusApplied ? Number(chantier.maskBonus) : 0,
    zoneBonus: p.zoneBonusApplied ? Number(chantier.zoneBonus) : 0,
    kmPerDay: p.kmReimbursementApplied ? Number(assignment?.distanceKm ?? 0) * Number(assignment?.kmRate ?? 0) : 0,
  }));

  const buffer = await buildAccountingWorkbook({
    employeeName: `${employee.firstName} ${employee.lastName}`,
    chantierName: chantier.name,
    weeks,
    sncfExpense: Number(assignment?.sncfExpense ?? 0),
    roomDeduction: Number(assignment?.roomDeduction ?? 0),
  });

  const fileName = `Comptabilité - ${employee.firstName} ${employee.lastName} - ${chantier.name}.xlsx`;
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({
    buffer,
    fileName,
    crmId: tenant.crmId,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const folderId = await findOrCreateRootFolder(tenant.crmId, employeeId, ACCOUNTING_FOLDER_NAME, ctx.user.id);

  const doc = await prisma.vaultDocument.create({
    data: {
      crmId: tenant.crmId,
      userId: employeeId,
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.length,
      storageKey,
      category: VaultDocumentCategory.ACCOUNTING_EXPORT,
      folderId,
      uploadedById: ctx.user.id,
      chantierId,
      foremanId,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "accounting.export_generated",
    entityType: "VAULT_DOCUMENT",
    entityId: doc.id,
    newValue: { employeeId, chantierId, weekCount: weeks.length },
  });

  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath(`/c/${tenant.crmSlug}/comptabilite`);
  return { ok: true };
}
