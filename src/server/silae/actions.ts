"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireOperationsAccess } from "@/server/tenant";
import { logActivity } from "@/server/activity";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { aggregateEmployeeMonth, type AggregationWeekInput } from "@/server/silae/aggregate";
import { buildSilaeReport, type AbsenceInput, type MappingRow, type SilaeReport } from "@/server/silae/report";
import { encodeSilaeCsv, renderSilaeCsv, silaeFileName, type SilaeEncoding } from "@/server/silae/csv";
import type { PointageDay } from "@/server/pointage/calc";
import { CONTROL_CHARS_MESSAGE, MAX_CODE, MAX_SHORT, NO_CONTROL_CHARS, tooLong } from "@/lib/validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toDayArray(value: unknown): PointageDay[] {
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
 * Lit la table de correspondance, en créant à la volée les rubriques
 * manquantes avec leurs valeurs par défaut.
 *
 * Provisionnement paresseux plutôt que semé : une rubrique ajoutée au
 * catalogue (src/server/silae/rubriques.ts) apparaît alors dans le
 * paramétrage des espaces DÉJÀ créés, sans migration ni ré-exécution du
 * seed.
 */
export async function listSilaeMappings(crmId: string, actorCtx?: AuthContext): Promise<MappingRow[]> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const existing = await prisma.silaeCodeMapping.findMany({ where: { crmId: tenant.crmId } });
  const known = new Set(existing.map((m) => m.rubrique));
  const missing = RUBRIQUES.filter((r) => !known.has(r.key));
  if (missing.length > 0) {
    await prisma.silaeCodeMapping.createMany({
      data: missing.map((r) => ({
        crmId: tenant.crmId,
        rubrique: r.key,
        silaeCode: r.defaultCode,
        exported: r.defaultExported,
      })),
      skipDuplicates: true,
    });
  }

  const rows = await prisma.silaeCodeMapping.findMany({ where: { crmId: tenant.crmId } });
  const byKey = new Map(rows.map((r) => [r.rubrique, r]));
  // Ordonné comme le catalogue, pour que l'écran suive toujours le même plan.
  return RUBRIQUES.map((def) => {
    const row = byKey.get(def.key);
    return {
      rubrique: def.key,
      silaeCode: row?.silaeCode ?? def.defaultCode,
      multiplier: row ? Number(row.multiplier) : 1,
      exported: row?.exported ?? def.defaultExported,
    };
  });
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

export interface SilaeExportOptions {
  exportWorkedHours?: boolean;
  encoding?: SilaeEncoding;
}

/**
 * Construit le rapport de contrôle ET les lignes du fichier pour un mois.
 *
 * Les pointages retenus sont ceux dont la SEMAINE touche le mois : une
 * semaine commencée le 28 septembre porte des jours d'octobre, et l'inverse
 * est vrai en fin de mois. Le tri fin (quel jour compte pour quel mois) est
 * fait par aggregateEmployeeMonth, jamais ici.
 */
async function collectMonth(crmId: string, year: number, month: number, options: SilaeExportOptions) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const windowStart = new Date(monthStart);
  windowStart.setUTCDate(windowStart.getUTCDate() - 6);

  const [crm, pointages, acomptes, accesses, reglages] = await Promise.all([
    prisma.crm.findUniqueOrThrow({ where: { id: crmId }, select: { name: true } }),
    prisma.pointage.findMany({
      where: { crmId, weekStart: { gte: windowStart, lte: monthEnd } },
      include: {
        chantier: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { weekStart: "asc" },
    }),
    prisma.acompte.findMany({ where: { crmId, payrollMonth: monthStart } }),
    prisma.userCrmAccess.findMany({ where: { crmId }, select: { userId: true, silaeMatricule: true } }),
    // Règle applicable à un dimanche férié : sans elle, ces heures
    // alimentaient les deux rubriques et Silae majorait deux fois.
    prisma.crmPointageSettings.findUnique({ where: { crmId }, select: { sundayHolidayRule: true } }),
  ]);

  // Les absences ne sont pas exportées (format Silae encore inconnu) : elles
  // doivent donc au moins être NOMMÉES dans le rapport, sinon une absence
  // saisie ici disparaît purement et simplement de la paie. On retient toute
  // absence qui chevauche le mois, pas seulement celles qui y commencent.
  const absenceRows = await prisma.absence.findMany({
    where: { crmId, startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { startDate: "asc" },
  });
  const absences: AbsenceInput[] = absenceRows.map((a) => ({
    employeeName: `${a.user.firstName} ${a.user.lastName}`.trim(),
    type: a.type,
    startDate: a.startDate,
    endDate: a.endDate,
    hours: a.hours === null ? null : Number(a.hours),
    days: a.days === null ? null : Number(a.days),
  }));

  const matriculeByUser = new Map(accesses.map((a) => [a.userId, a.silaeMatricule?.trim() || null]));

  const assignments = await prisma.chantierAssignment.findMany({
    where: {
      chantierId: { in: Array.from(new Set(pointages.map((p) => p.chantierId))) },
      // Les identifiants viennent déjà de pointages filtrés par crmId, mais
      // la règle du schéma vaut pour TOUTE requête : on ne s'en remet pas à
      // la provenance des identifiants.
      chantier: { crmId },
    },
  });
  const assignmentByKey = new Map(assignments.map((a) => [`${a.chantierId}\u0000${a.userId}`, a]));

  const weeksByEmployee = new Map<string, { name: string; weeks: AggregationWeekInput[] }>();
  for (const p of pointages) {
    const a = assignmentByKey.get(`${p.chantierId}\u0000${p.employeeId}`);
    const entry = weeksByEmployee.get(p.employeeId) ?? {
      name: `${p.employee.firstName} ${p.employee.lastName}`.trim(),
      weeks: [],
    };
    entry.weeks.push({
      weekStart: p.weekStart,
      chantierId: p.chantierId,
      days: toDayArray(p.days),
      hourlyRate: Number(p.hourlyRate),
      nightRatePercent: Number(p.nightRatePercent),
      housingAllowance: Number(p.housingAllowance),
      dirtAllowance: Number(p.dirtAllowance),
      gdDepl53Count: p.gdDepl53Count,
      gdDepl80Count: p.gdDepl80Count,
      chantierAmounts: {
        lunchAllowance: Number(p.chantier.lunchAllowance),
        dinnerAllowance: Number(p.chantier.dinnerAllowance),
        travelAllowance: Number(p.chantier.travelAllowance),
        maskBonus: Number(p.chantier.maskBonus),
        managementBonus: Number(p.chantier.managementBonus),
        zoneBonus: Number(p.chantier.zoneBonus),
        postBonus: Number(p.chantier.postBonus),
        mealAllowance: Number(p.chantier.mealAllowance),
        clothingBonus: Number(p.chantier.clothingBonus),
      },
      assignmentRates: {
        kmRate: Number(a?.kmRate ?? 0),
        distanceKm: Number(a?.distanceKm ?? 0),
        travelHourlyRate: Number(a?.travelHourlyRate ?? 0),
        travelDurationHours: Number(a?.travelDurationHours ?? 0),
      },
      applied: {
        lunchAllowanceApplied: p.lunchAllowanceApplied,
        dinnerAllowanceApplied: p.dinnerAllowanceApplied,
        travelAllowanceApplied: p.travelAllowanceApplied,
        maskBonusApplied: p.maskBonusApplied,
        managementBonusApplied: p.managementBonusApplied,
        zoneBonusApplied: p.zoneBonusApplied,
        postBonusApplied: p.postBonusApplied,
        kmReimbursementApplied: p.kmReimbursementApplied,
        travelHoursReimbursementApplied: p.travelHoursReimbursementApplied,
        mealAllowanceApplied: p.mealAllowanceApplied,
        clothingBonusApplied: p.clothingBonusApplied,
      },
      sncfExpense: Number(a?.sncfExpense ?? 0),
      roomDeduction: Number(a?.roomDeduction ?? 0),
    });
    weeksByEmployee.set(p.employeeId, entry);
  }

  // Un salarié peut n'avoir qu'un acompte sur le mois, sans aucun pointage :
  // il doit quand même figurer dans l'export.
  for (const ac of acomptes) {
    if (!weeksByEmployee.has(ac.userId)) weeksByEmployee.set(ac.userId, { name: "", weeks: [] });
  }
  const missingNames = Array.from(weeksByEmployee.entries()).filter(([, v]) => !v.name).map(([id]) => id);
  if (missingNames.length > 0) {
    const users = await prisma.user.findMany({ where: { id: { in: missingNames } }, select: { id: true, firstName: true, lastName: true } });
    for (const u of users) {
      const entry = weeksByEmployee.get(u.id)!;
      entry.name = `${u.firstName} ${u.lastName}`.trim();
    }
  }

  const acompteByUser = new Map<string, number>();
  for (const ac of acomptes) {
    acompteByUser.set(ac.userId, (acompteByUser.get(ac.userId) ?? 0) + Number(ac.amount));
  }

  const employees = Array.from(weeksByEmployee.entries())
    .map(([userId, { name, weeks }]) => {
      const agg = aggregateEmployeeMonth(weeks, year, month, {
        exportWorkedHours: options.exportWorkedHours,
        sundayHolidayRule: reglages?.sundayHolidayRule,
      });
      const acompte = acompteByUser.get(userId);
      if (acompte) agg.totals.acompte = Math.round(acompte * 100) / 100;
      return {
        userId,
        name,
        matricule: matriculeByUser.get(userId) ?? null,
        monthHours: agg.monthHours,
        totals: agg.totals,
        anomalies: agg.anomalies,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return { employees, dossier: crm.name, absences };
}

export interface SilaePreviewResult extends ActionResult {
  report?: SilaeReport;
}

export async function previewSilaeExport(
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {},
  actorCtx?: AuthContext
): Promise<SilaePreviewResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const mappings = await listSilaeMappings(tenant.crmId, ctx);
  const { employees, dossier, absences } = await collectMonth(tenant.crmId, year, month, options);
  const { report } = buildSilaeReport(employees, mappings, { year, month, dossier, absences });
  return { ok: true, report };
}

export interface SilaeGenerateResult extends ActionResult {
  fileName?: string;
  /** Contenu encodé, en base64 : le transport d'une server action est du JSON. */
  contentBase64?: string;
  report?: SilaeReport;
}

export async function generateSilaeExport(
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {},
  actorCtx?: AuthContext
): Promise<SilaeGenerateResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const mappings = await listSilaeMappings(tenant.crmId, ctx);
  const { employees, dossier, absences } = await collectMonth(tenant.crmId, year, month, options);
  const { report, lines } = buildSilaeReport(employees, mappings, { year, month, dossier, absences });

  if (report.blocking.length > 0) {
    return { ok: false, error: "Des points bloquants doivent être levés avant de générer le fichier.", report };
  }
  if (lines.length === 0) {
    return { ok: false, error: "Aucun élément à exporter pour ce mois.", report };
  }

  const content = renderSilaeCsv(lines);
  const buffer = encodeSilaeCsv(content, options.encoding ?? "win1252");

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "silae.export_generated",
    entityType: "SilaeExport",
    newValue: { year, month, lines: lines.length, encoding: options.encoding ?? "win1252" },
  });

  return {
    ok: true,
    fileName: silaeFileName(dossier, year, month),
    contentBase64: buffer.toString("base64"),
    report,
  };
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
