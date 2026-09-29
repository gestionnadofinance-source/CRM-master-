"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireOperationsAccess } from "@/server/tenant";
import { logActivity } from "@/server/activity";
import { RUBRIQUES } from "@/server/silae/rubriques";
import type { MappingRow } from "@/server/silae/report";
import { CONTROL_CHARS_MESSAGE, MAX_CODE, MAX_SHORT, NO_CONTROL_CHARS, tooLong } from "@/lib/validation";

import {
  listSilaeMappingsCore,
  previewSilaeExportCore,
  generateSilaeExportCore,
  type ActionResult,
  type SilaeExportOptions,
  type SilaePreviewResult,
  type SilaeGenerateResult,
} from "@/server/silae/core";

export type { ActionResult, SilaeExportOptions, SilaePreviewResult, SilaeGenerateResult };

/** Adaptateur "use server" : résout la session, puis délègue au cœur. */
export async function listSilaeMappings(crmId: string): Promise<MappingRow[]> {
  return listSilaeMappingsCore(await requireAuth(), crmId);
}

export async function previewSilaeExport(
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {}
): Promise<SilaePreviewResult> {
  return previewSilaeExportCore(await requireAuth(), crmId, year, month, options);
}

export async function generateSilaeExport(
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {}
): Promise<SilaeGenerateResult> {
  return generateSilaeExportCore(await requireAuth(), crmId, year, month, options);
}

const mappingSchema = z.object({
  silaeCode: z
    .string()
    .trim()
    .max(MAX_CODE, tooLong(MAX_CODE))
    .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  multiplier: z.coerce.number().gt(0, "Le multiplicateur doit être strictement positif.").max(100000),
  exported: z.boolean(),
});

export async function updateSilaeMapping(crmId: string, rubrique: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  if (!RUBRIQUES.some((r) => r.key === rubrique)) {
    return { ok: false, error: "Rubrique inconnue." };
  }
  const parsed = mappingSchema.safeParse({
    silaeCode: String(formData.get("silaeCode") ?? ""),
    multiplier: formData.get("multiplier") ?? 1,
    exported: formData.get("exported") === "true",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeur invalide." };

  await prisma.silaeCodeMapping.upsert({
    where: { crmId_rubrique: { crmId: tenant.crmId, rubrique } },
    update: parsed.data,
    create: { crmId: tenant.crmId, rubrique, ...parsed.data },
  });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "silae.mapping_updated",
    entityType: "SilaeCodeMapping",
    newValue: { rubrique, ...parsed.data },
  });
  revalidatePath(`/c/${tenant.crmSlug}/silae`);
  return { ok: true };
}

// --- Acomptes --------------------------------------------------------------

const acompteSchema = z.object({
  userId: z.string().trim().min(1, "Sélectionnez un salarié."),
  amount: z.coerce.number().gt(0, "Le montant doit être strictement positif.").max(99999.99),
  paidOn: z.coerce.date(),
  payrollMonth: z.string().regex(/^\d{4}-\d{2}$/, "Mois de paie invalide."),
  comment: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(),
});

export async function createAcompte(crmId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const parsed = acompteSchema.safeParse({
    userId: formData.get("userId") ?? "",
    amount: formData.get("amount") ?? 0,
    paidOn: formData.get("paidOn") ?? "",
    payrollMonth: String(formData.get("payrollMonth") ?? ""),
    comment: String(formData.get("comment") ?? "") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  const access = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: parsed.data.userId, crmId: tenant.crmId } },
  });
  if (!access) return { ok: false, error: "Ce salarié n'a pas accès à cet espace." };

  const [y, m] = parsed.data.payrollMonth.split("-").map(Number);
  await prisma.acompte.create({
    data: {
      crmId: tenant.crmId,
      userId: parsed.data.userId,
      amount: parsed.data.amount,
      paidOn: parsed.data.paidOn,
      payrollMonth: new Date(Date.UTC(y!, m! - 1, 1)),
      comment: parsed.data.comment ?? null,
      createdById: ctx.user.id,
    },
  });
  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "silae.acompte_created", entityType: "Acompte" });
  revalidatePath(`/c/${tenant.crmSlug}/silae`);
  return { ok: true };
}

export async function deleteAcompte(crmId: string, acompteId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const acompte = await prisma.acompte.findUnique({ where: { id: acompteId } });
  if (!acompte || acompte.crmId !== tenant.crmId) return { ok: false, error: "Acompte introuvable." };

  await prisma.acompte.delete({ where: { id: acompteId } });
  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "silae.acompte_deleted", entityType: "Acompte" });
  revalidatePath(`/c/${tenant.crmSlug}/silae`);
  return { ok: true };
}

// --- Absences --------------------------------------------------------------

const absenceSchema = z.object({
  userId: z.string().trim().min(1, "Sélectionnez un salarié."),
  type: z.enum(["CONGE_PAYE", "MALADIE", "ABSENCE_INJUSTIFIEE", "REPOS_COMPENSATEUR", "ACCIDENT_TRAVAIL", "CONGE_SANS_SOLDE", "AUTRE"]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  hours: z.coerce.number().min(0).max(9999).optional(),
  days: z.coerce.number().min(0).max(999).optional(),
  comment: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(),
});

export async function createAbsence(crmId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const raw = {
    userId: formData.get("userId") ?? "",
    type: String(formData.get("type") ?? "AUTRE"),
    startDate: formData.get("startDate") ?? "",
    endDate: formData.get("endDate") ?? "",
    hours: formData.get("hours") || undefined,
    days: formData.get("days") || undefined,
    comment: String(formData.get("comment") ?? "") || undefined,
  };
  const parsed = absenceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: "La date de fin doit être postérieure à la date de début." };
  }

  const access = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: parsed.data.userId, crmId: tenant.crmId } },
  });
  if (!access) return { ok: false, error: "Ce salarié n'a pas accès à cet espace." };

  await prisma.absence.create({
    data: {
      crmId: tenant.crmId,
      userId: parsed.data.userId,
      type: parsed.data.type,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      hours: parsed.data.hours ?? null,
      days: parsed.data.days ?? null,
      comment: parsed.data.comment ?? null,
      createdById: ctx.user.id,
    },
  });
  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "silae.absence_created", entityType: "Absence" });
  revalidatePath(`/c/${tenant.crmSlug}/silae`);
  return { ok: true };
}

export async function deleteAbsence(crmId: string, absenceId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const absence = await prisma.absence.findUnique({ where: { id: absenceId } });
  if (!absence || absence.crmId !== tenant.crmId) return { ok: false, error: "Absence introuvable." };

  await prisma.absence.delete({ where: { id: absenceId } });
  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "silae.absence_deleted", entityType: "Absence" });
  revalidatePath(`/c/${tenant.crmSlug}/silae`);
  return { ok: true };
}
