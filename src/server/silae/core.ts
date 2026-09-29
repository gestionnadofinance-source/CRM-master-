import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/server/auth/session";
import { requireOperationsAccess } from "@/server/tenant";
import { logActivity } from "@/server/activity";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { aggregateEmployeeMonth, type AggregationWeekInput } from "@/server/silae/aggregate";
import { buildSilaeReport, type AbsenceInput, type MappingRow, type SilaeReport } from "@/server/silae/report";
import { encodeSilaeCsv, renderSilaeCsv, silaeFileName, type SilaeEncoding } from "@/server/silae/csv";
import type { PointageDay } from "@/server/pointage/calc";

/**
 * Cœur des lectures et exports Silae, SANS contrôle d'accès embarqué : chaque
 * fonction reçoit un AuthContext DÉJÀ établi et le passe à requireOperationsAccess.
 *
 * Vit hors du module "use server" à dessein. Dans un tel module, tout export
 * est une action appelable depuis le navigateur avec des arguments
 * arbitraires ; un paramètre de contexte y serait donc forgeable, et un
 * client pourrait se faire passer pour un administrateur. Le contexte n'est
 * légitime que construit côté serveur (session vérifiée, ou clé API) — jamais
 * reçu du client. Voir src/server/vault/core.ts, même règle.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface SilaeExportOptions {
  exportWorkedHours?: boolean;
  encoding?: SilaeEncoding;
}

export interface SilaePreviewResult extends ActionResult {
  report?: SilaeReport;
}

export interface SilaeGenerateResult extends ActionResult {
  fileName?: string;
  /** Contenu encodé, en base64 : le transport d'une server action est du JSON. */
  contentBase64?: string;
  report?: SilaeReport;
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
export async function listSilaeMappingsCore(ctx: AuthContext, crmId: string): Promise<MappingRow[]> {
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


export async function previewSilaeExportCore(
  ctx: AuthContext,
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {}
): Promise<SilaePreviewResult> {
  const tenant = await requireOperationsAccess(ctx, crmId);

  const mappings = await listSilaeMappingsCore(ctx, tenant.crmId);
  const { employees, dossier, absences } = await collectMonth(tenant.crmId, year, month, options);
  const { report } = buildSilaeReport(employees, mappings, { year, month, dossier, absences });
  return { ok: true, report };
}


export async function generateSilaeExportCore(
  ctx: AuthContext,
  crmId: string,
  year: number,
  month: number,
  options: SilaeExportOptions = {}
): Promise<SilaeGenerateResult> {
  const tenant = await requireOperationsAccess(ctx, crmId);

  const mappings = await listSilaeMappingsCore(ctx, tenant.crmId);
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

