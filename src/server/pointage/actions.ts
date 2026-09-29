"use server";

import { z } from "zod";
import { getISOWeek } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { AuthError } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm, type TenantContext } from "@/server/tenant";
import {
  getIsForeman,
  requireForeman,
  toDayArray,
  upsertPointageEntryCore,
  deletePointageEntryCore,
} from "@/server/pointage/core";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { getStorageDriver } from "@/lib/storage";
import { sendEmail, baseEmailLayout } from "@/lib/email";
import { publishToUser } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { VaultDocumentCategory } from "@prisma/client";
import { findOrCreateRootFolder } from "@/server/vault/actions";
import { computePointageTotals, mondayOf, buildEmptyWeek, type PointageDay } from "@/server/pointage/calc";
import { renderEmployeeTimesheetPdf, renderClientTimesheetPdf } from "@/server/pointage/pdf";
import { MAX_CODE, MAX_ID, MAX_LONG, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";
import { isTransverseCategory } from "@/server/permissions";

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Renseigné par les actions d'upsert, pour que l'API publique réponde 201 ou 200. */
  created?: boolean;
}

/**
 * Résultat des envois/dépôts en masse (voir emailEmployeeTimesheets /
 * depositEmployeeTimesheets) : un échec de rendu PDF ou de dépôt pour UN
 * salarié n'interrompt plus le traitement des autres — failedEmployees liste
 * ceux dont la fiche n'a pas pu être traitée, pour que l'appelant sache
 * précisément qui doit être relancé, plutôt que de perdre cette information
 * si l'opération entière échouait au milieu du traitement.
 */
export interface TimesheetsResult extends ActionResult {
  failedEmployees?: string[];
}

/** Taille des lots pour le rendu PDF en masse — évite de générer d'un coup, en mémoire, autant de PDF que de salariés sur le chantier (voir emailEmployeeTimesheets). */
const TIMESHEET_BATCH_SIZE = 10;

/** Liste les chantiers auxquels l'utilisateur courant, chef de chantier, est affecté (ou tous, pour un admin global). */
const chantierSummarySelect = { id: true, name: true, address: true, startDate: true, endDate: true } as const;

export async function listMyForemanChantiers(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);

  if (tenant.isGlobalAdmin || isTransverseCategory(tenant.category)) {
    return prisma.chantier.findMany({
      where: { crmId: tenant.crmId },
      orderBy: { startDate: "desc" },
      select: chantierSummarySelect,
    });
  }
  const isForeman = await getIsForeman(ctx.user.id, tenant.crmId);
  if (!isForeman) return [];
  const assignments = await prisma.chantierAssignment.findMany({
    where: { userId: ctx.user.id, chantier: { crmId: tenant.crmId } },
    include: { chantier: { select: chantierSummarySelect } },
    orderBy: { chantier: { startDate: "desc" } },
  });
  return assignments.map((a) => a.chantier);
}

/** Utilisé par la navigation (sidebar + layout) pour savoir si les onglets Pointage salariés/client doivent être affichés. */
export async function amIForeman(crmId: string): Promise<boolean> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  if (tenant.isGlobalAdmin || isTransverseCategory(tenant.category)) return true;
  return getIsForeman(ctx.user.id, tenant.crmId);
}

async function getOrCreatePointageSettings(crmId: string) {
  const existing = await prisma.crmPointageSettings.findUnique({ where: { crmId } });
  if (existing) return existing;
  return prisma.crmPointageSettings.create({ data: { crmId } });
}

export async function getPointageSettings(crmId: string) {
  const ctx = await requireAuth();
  await requireCrmAccess(ctx, crmId);
  const s = await getOrCreatePointageSettings(crmId);
  return {
    nightRatePercent: Number(s.nightRatePercent),
    sundayHolidayRule: s.sundayHolidayRule,
  };
}

const settingsSchema = z.object({
  nightRatePercent: z.coerce.number().min(0).max(500),
  // Voir SundayHolidayRule dans prisma/schema.prisma : la règle dépend de la
  // convention collective, elle se choisit donc ici et pas dans le code.
  sundayHolidayRule: z.enum(["CUMUL", "FERIE_PRIORITAIRE", "DIMANCHE_PRIORITAIRE"]).default("FERIE_PRIORITAIRE"),
});

export async function updatePointageSettings(crmId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };

  await prisma.crmPointageSettings.upsert({
    where: { crmId: tenant.crmId },
    create: { crmId: tenant.crmId, ...parsed.data },
    update: parsed.data,
  });
  revalidatePath(`/c/${tenant.crmSlug}/settings`);
  return { ok: true };
}

/** Trombinoscope + pointages existants des ouvriers affectés à un chantier pour une semaine donnée (chef de chantier uniquement). */
export async function listChantierRosterForWeek(crmId: string, chantierId: string, weekStartIso: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) throw new AuthError("CRM_ACCESS_DENIED", "Chantier introuvable.");
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");
  await requireForeman(ctx, tenant, chantierId);

  const weekStart = mondayOf(new Date(weekStartIso));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const [assignments, pointages, settings] = await Promise.all([
    prisma.chantierAssignment.findMany({
      // Un ouvrier n'apparaît dans la feuille de pointage du chef de
      // chantier QUE pour les semaines où il est effectivement mobilisé sur
      // ce chantier (période définie par l'admin dans Planning) — pas pour
      // toute la durée de vie de l'affectation. Sans date de début/fin
      // renseignée, l'affectation reste visible sans restriction (comme
      // avant), le chevauchement de dates étant une information optionnelle.
      where: {
        chantierId,
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: weekEnd } }] },
          { OR: [{ endDate: null }, { endDate: { gte: weekStart } }] },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            color: true,
            crmAccess: { where: { crmId: tenant.crmId }, take: 1 },
          },
        },
      },
    }),
    prisma.pointage.findMany({ where: { crmId: tenant.crmId, chantierId, weekStart } }),
    getOrCreatePointageSettings(tenant.crmId),
  ]);

  const pointageByEmployee = new Map(pointages.map((p) => [p.employeeId, p]));

  // Montants fixes du chantier : communs à tout le monde, calculés une
  // seule fois (voir Chantier, saisis sur la fiche du chantier — Planning).
  const chantierAmounts = {
    lunchAllowance: Number(chantier.lunchAllowance),
    dinnerAllowance: Number(chantier.dinnerAllowance),
    travelAllowance: Number(chantier.travelAllowance),
    maskBonus: Number(chantier.maskBonus),
    managementBonus: Number(chantier.managementBonus),
    zoneBonus: Number(chantier.zoneBonus),
    postBonus: Number(chantier.postBonus),
    mealAllowance: Number(chantier.mealAllowance),
    clothingBonus: Number(chantier.clothingBonus),
  };

  const roster = assignments.map((a) => {
    const access = a.user.crmAccess[0];
    const existing = pointageByEmployee.get(a.user.id);
    // Seules les primes propres au salarié (logement, salissure) restent
    // des montants saisis, pré-remplis depuis ses défauts (UserCrmAccess).
    const primes = existing
      ? {
          housingAllowance: Number(existing.housingAllowance),
          dirtAllowance: Number(existing.dirtAllowance),
        }
      : {
          housingAllowance: Number(access?.defaultHousingAllowance ?? 0),
          dirtAllowance: Number(access?.defaultDirtAllowance ?? 0),
        };
    // Les taux nuit (horaire de base + % de majoration) sont propres à
    // CHAQUE fiche, choisis par le chef de chantier — le taux horaire par
    // défaut du salarié (UserCrmAccess) et le % de majoration CRM
    // (settings) ne servent qu'à préremplir une fiche encore jamais
    // saisie. Une fois enregistrée, la fiche ne reprend plus que ses
    // propres valeurs, jamais les réglages courants.
    const rates = existing
      ? { hourlyRate: Number(existing.hourlyRate), nightRatePercent: Number(existing.nightRatePercent) }
      : { hourlyRate: Number(access?.defaultHourlyRate ?? 0), nightRatePercent: Number(settings.nightRatePercent) };
    // Distance/temps de trajet propres à CETTE affectation (voir
    // ChantierAssignment, saisis à l'attribution — Planning).
    const assignmentRates = {
      kmRate: Number(a.kmRate ?? 0),
      distanceKm: Number(a.distanceKm ?? 0),
      travelHourlyRate: Number(a.travelHourlyRate ?? 0),
      travelDurationHours: Number(a.travelDurationHours ?? 0),
    };
    // Cases cochées par le chef de chantier — jamais pré-cochées par
    // défaut sur une nouvelle fiche : c'est à lui de choisir, semaine par
    // semaine, lesquelles s'appliquent à ce salarié.
    const applied = existing
      ? {
          lunchAllowanceApplied: existing.lunchAllowanceApplied,
          dinnerAllowanceApplied: existing.dinnerAllowanceApplied,
          travelAllowanceApplied: existing.travelAllowanceApplied,
          maskBonusApplied: existing.maskBonusApplied,
          managementBonusApplied: existing.managementBonusApplied,
          zoneBonusApplied: existing.zoneBonusApplied,
          postBonusApplied: existing.postBonusApplied,
          kmReimbursementApplied: existing.kmReimbursementApplied,
          travelHoursReimbursementApplied: existing.travelHoursReimbursementApplied,
          mealAllowanceApplied: existing.mealAllowanceApplied,
          clothingBonusApplied: existing.clothingBonusApplied,
        }
      : {
          lunchAllowanceApplied: false,
          dinnerAllowanceApplied: false,
          travelAllowanceApplied: false,
          maskBonusApplied: false,
          managementBonusApplied: false,
          zoneBonusApplied: false,
          postBonusApplied: false,
          kmReimbursementApplied: false,
          travelHoursReimbursementApplied: false,
          mealAllowanceApplied: false,
          clothingBonusApplied: false,
        };
    const days = existing ? toDayArray(existing.days) : buildEmptyWeek(weekStart);
    return {
      employeeId: a.user.id,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      color: a.user.color,
      isForeman: access?.isForeman ?? false,
      hasEntry: !!existing,
      pointageId: existing?.id ?? null,
      days,
      primes,
      rates,
      chantierAmounts,
      assignmentRates,
      applied,
      grandsDeplacements: {
        gdDepl53Count: existing?.gdDepl53Count ?? 0,
        gdDepl80Count: existing?.gdDepl80Count ?? 0,
      },
      comments: existing?.comments ?? "",
      totals: computePointageTotals(days, rates, primes, chantierAmounts, assignmentRates, applied),
    };
  });

  return {
    chantier: { id: chantier.id, name: chantier.name, address: chantier.address },
    weekStart: weekStart.toISOString(),
    roster,
  };
}


/** Adaptateur "use server" : résout la session, puis délègue au cœur. */
export async function upsertPointageEntry(crmId: string, chantierId: string, formData: FormData): Promise<ActionResult> {
  return upsertPointageEntryCore(await requireAuth(), crmId, chantierId, formData);
}

export async function deletePointageEntry(crmId: string, pointageId: string): Promise<ActionResult> {
  return deletePointageEntryCore(await requireAuth(), crmId, pointageId);
}

async function loadWeekData(tenant: TenantContext, chantierId: string, weekStartIso: string) {
  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) throw new AuthError("CRM_ACCESS_DENIED", "Chantier introuvable.");
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");
  const weekStart = mondayOf(new Date(weekStartIso));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const pointages = await prisma.pointage.findMany({
    where: { crmId: tenant.crmId, chantierId, weekStart },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { employee: { firstName: "asc" } },
  });

  const assignments = await prisma.chantierAssignment.findMany({
    where: { chantierId, userId: { in: pointages.map((p) => p.employeeId) } },
  });
  const assignmentByEmployee = new Map(assignments.map((a) => [a.userId, a]));

  const chantierAmounts = {
    lunchAllowance: Number(chantier.lunchAllowance),
    dinnerAllowance: Number(chantier.dinnerAllowance),
    travelAllowance: Number(chantier.travelAllowance),
    maskBonus: Number(chantier.maskBonus),
    managementBonus: Number(chantier.managementBonus),
    zoneBonus: Number(chantier.zoneBonus),
    postBonus: Number(chantier.postBonus),
    mealAllowance: Number(chantier.mealAllowance),
    clothingBonus: Number(chantier.clothingBonus),
  };

  return { chantier, weekStart, weekEnd, pointages, assignmentByEmployee, chantierAmounts };
}

/** Distance/temps de trajet propres à l'affectation de ce salarié sur ce chantier. */
function assignmentRatesOf(
  a: { kmRate: unknown; distanceKm: unknown; travelHourlyRate: unknown; travelDurationHours: unknown } | undefined
) {
  return {
    kmRate: Number(a?.kmRate ?? 0),
    distanceKm: Number(a?.distanceKm ?? 0),
    travelHourlyRate: Number(a?.travelHourlyRate ?? 0),
    travelDurationHours: Number(a?.travelDurationHours ?? 0),
  };
}

/** Envoie par email (à l'adresse du chef de chantier connecté) les fiches PDF de tous les salariés pointés cette semaine. */
export async function emailEmployeeTimesheets(crmId: string, chantierId: string, weekStartIso: string): Promise<TimesheetsResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await requireForeman(ctx, tenant, chantierId);
  const { chantier, weekStart, weekEnd, pointages, assignmentByEmployee, chantierAmounts } = await loadWeekData(
    tenant,
    chantierId,
    weekStartIso
  );
  if (pointages.length === 0) return { ok: false, error: "Aucune fiche salarié saisie pour cette semaine." };

  const weekNumber = getISOWeek(weekStart);
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  const failedEmployees: string[] = [];

  // Par lots plutôt qu'un unique Promise.all sur tout le chantier : évite de
  // garder en mémoire, simultanément, autant de PDF que de salariés sur un
  // roster important (voir l'audit). Un échec de rendu pour un salarié est
  // isolé et journalisé plutôt que de faire échouer l'envoi des autres.
  for (let i = 0; i < pointages.length; i += TIMESHEET_BATCH_SIZE) {
    const batch = pointages.slice(i, i + TIMESHEET_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (p) => {
        const employeeName = `${p.employee.firstName} ${p.employee.lastName}`;
        try {
          const buffer = await renderEmployeeTimesheetPdf({
            crmName: tenant.crmName,
            chantierName: chantier.name,
            chantierAddress: chantier.address,
            employeeName,
            foremanName: `${ctx.user.firstName} ${ctx.user.lastName}`,
            weekStart,
            weekEnd,
            weekNumber,
            days: toDayArray(p.days),
            rates: { hourlyRate: Number(p.hourlyRate), nightRatePercent: Number(p.nightRatePercent) },
            primes: { housingAllowance: Number(p.housingAllowance), dirtAllowance: Number(p.dirtAllowance) },
            chantierAmounts,
            assignmentRates: assignmentRatesOf(assignmentByEmployee.get(p.employeeId)),
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
            comments: p.comments,
          });
          return {
            ok: true as const,
            employeeName,
            filename: `pointage-${employeeName.replace(/\s+/g, "-")}-S${weekNumber}.pdf`,
            content: buffer,
            contentType: "application/pdf",
          };
        } catch (err) {
          console.error(`emailEmployeeTimesheets: échec de rendu PDF pour ${employeeName} (chantier ${chantierId}, semaine ${weekStartIso})`, err);
          return { ok: false as const, employeeName };
        }
      })
    );
    for (const r of results) {
      if (r.ok) attachments.push({ filename: r.filename, content: r.content, contentType: r.contentType });
      else failedEmployees.push(r.employeeName);
    }
  }

  if (attachments.length === 0) {
    return { ok: false, error: "Aucune fiche n'a pu être générée." };
  }

  const result = await sendEmail({
    to: ctx.user.email,
    subject: `Feuilles de pointage — ${chantier.name} — Semaine ${weekNumber}`,
    html: baseEmailLayout(
      "Feuilles de pointage",
      `<p>Ci-joint les feuilles de pointage de la semaine ${weekNumber} pour le chantier ${chantier.name} (${attachments.length} salarié${attachments.length > 1 ? "s" : ""}).</p>`
    ),
    attachments,
  });
  if (!result.delivered) return { ok: false, error: "SMTP non configuré : impossible d'envoyer l'email dans cet environnement." };

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pointage.employee_sheets_emailed",
    entityType: "POINTAGE",
    entityId: chantierId,
    newValue: failedEmployees.length > 0 ? { failedEmployees } : undefined,
  });
  return { ok: true, failedEmployees: failedEmployees.length > 0 ? failedEmployees : undefined };
}

/**
 * Dépose les fiches PDF de chaque salarié pointé dans son propre coffre-fort
 * (dossier "date - chantier"), + notifie et journalise. Accessible aussi aux
 * administrateurs.
 *
 * Traitement salarié par salarié, chacun isolé par son propre try/catch :
 * l'échec d'un salarié (rendu PDF, stockage ou écriture en base) n'empêche
 * plus le dépôt des autres, et est journalisé + renvoyé dans
 * failedEmployees plutôt que de silencieusement laisser certains salariés
 * sans fiche sans que personne ne le sache (voir l'audit).
 */
export async function depositEmployeeTimesheets(crmId: string, chantierId: string, weekStartIso: string): Promise<TimesheetsResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await requireForeman(ctx, tenant, chantierId);
  const { chantier, weekStart, weekEnd, pointages, assignmentByEmployee, chantierAmounts } = await loadWeekData(
    tenant,
    chantierId,
    weekStartIso
  );
  if (pointages.length === 0) return { ok: false, error: "Aucune fiche salarié saisie pour cette semaine." };

  const weekNumber = getISOWeek(weekStart);
  const folderName = `${weekStart.toLocaleDateString("fr-FR")} — ${chantier.name}`;
  const driver = getStorageDriver();
  const failedEmployees: string[] = [];
  let depositedCount = 0;

  for (const p of pointages) {
    const employeeName = `${p.employee.firstName} ${p.employee.lastName}`;
    try {
      const buffer = await renderEmployeeTimesheetPdf({
        crmName: tenant.crmName,
        chantierName: chantier.name,
        chantierAddress: chantier.address,
        employeeName,
        foremanName: `${ctx.user.firstName} ${ctx.user.lastName}`,
        weekStart,
        weekEnd,
        weekNumber,
        days: toDayArray(p.days),
        rates: { hourlyRate: Number(p.hourlyRate), nightRatePercent: Number(p.nightRatePercent) },
        primes: { housingAllowance: Number(p.housingAllowance), dirtAllowance: Number(p.dirtAllowance) },
        chantierAmounts,
        assignmentRates: assignmentRatesOf(assignmentByEmployee.get(p.employeeId)),
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
        comments: p.comments,
      });
      const fileName = `Pointage S${weekNumber} - ${employeeName}.pdf`;
      const { storageKey } = await driver.put({ buffer, fileName, crmId: tenant.crmId, mimeType: "application/pdf" });
      const folderId = await findOrCreateRootFolder(tenant.crmId, p.employeeId, folderName, ctx.user.id);

      const doc = await prisma.vaultDocument.create({
        data: {
          crmId: tenant.crmId,
          userId: p.employeeId,
          fileName,
          mimeType: "application/pdf",
          size: buffer.length,
          storageKey,
          category: VaultDocumentCategory.TIMESHEET_EMPLOYEE,
          folderId,
          // Période et chantier couverts, pour que le coffre-fort puisse
          // regrouper sans relire le nom du fichier ni rejoindre Pointage.
          periodStart: weekStart,
          chantierId,
          pointageId: p.id,
          uploadedById: ctx.user.id,
        },
      });

      await prisma.notification.create({
        data: {
          crmId: tenant.crmId,
          userId: p.employeeId,
          actorId: ctx.user.id,
          type: "DOCUMENT_ADDED",
          title: "Nouvelle feuille de pointage disponible",
          body: fileName,
          entityType: "VAULT_DOCUMENT",
          entityId: doc.id,
        },
      });
      await publishToUser(p.employeeId, "notification.created", { kind: "vault_document" });
      depositedCount++;
    } catch (err) {
      console.error(`depositEmployeeTimesheets: échec pour ${employeeName} (chantier ${chantierId}, semaine ${weekStartIso})`, err);
      failedEmployees.push(employeeName);
    }
  }

  if (depositedCount === 0) {
    return { ok: false, error: "Aucune fiche n'a pu être déposée." };
  }

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pointage.employee_sheets_deposited",
    entityType: "POINTAGE",
    entityId: chantierId,
    newValue: { folder: folderName, count: depositedCount, failedEmployees: failedEmployees.length > 0 ? failedEmployees : undefined },
  });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  return { ok: true, failedEmployees: failedEmployees.length > 0 ? failedEmployees : undefined };
}

/** Génère la fiche client agrégée (tous les salariés pointés cette semaine sur ce chantier). */
async function buildClientTimesheetPdf(tenant: TenantContext, ctx: AuthContext, chantierId: string, weekStartIso: string) {
  const { chantier, weekStart, weekEnd, pointages } = await loadWeekData(tenant, chantierId, weekStartIso);
  if (pointages.length === 0) return null;
  const weekNumber = getISOWeek(weekStart);
  const buffer = await renderClientTimesheetPdf({
    crmName: tenant.crmName,
    chantierName: chantier.name,
    weekStart,
    weekEnd,
    weekNumber,
    foremanName: `${ctx.user.firstName} ${ctx.user.lastName}`,
    rows: pointages.map((p) => ({ employeeName: `${p.employee.firstName} ${p.employee.lastName}`, days: toDayArray(p.days) })),
  });
  // weekStart est remonté pour être enregistré tel quel sur le document du
  // coffre-fort (VaultDocument.periodStart) : la semaine couverte, distincte
  // de la date de dépôt.
  return { buffer, weekNumber, weekStart, chantierName: chantier.name };
}

export async function emailClientTimesheet(crmId: string, chantierId: string, weekStartIso: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await requireForeman(ctx, tenant, chantierId);
  const rendered = await buildClientTimesheetPdf(tenant, ctx, chantierId, weekStartIso);
  if (!rendered) return { ok: false, error: "Aucune fiche salarié saisie pour cette semaine sur ce chantier." };

  const result = await sendEmail({
    to: ctx.user.email,
    subject: `Fiche de pointage client — ${rendered.chantierName} — Semaine ${rendered.weekNumber}`,
    html: baseEmailLayout("Fiche de pointage client", `<p>Ci-joint la fiche de pointage client de la semaine ${rendered.weekNumber} pour le chantier ${rendered.chantierName}.</p>`),
    attachments: [
      {
        filename: `pointage-client-S${rendered.weekNumber}.pdf`,
        content: rendered.buffer,
        contentType: "application/pdf",
      },
    ],
  });
  if (!result.delivered) return { ok: false, error: "SMTP non configuré : impossible d'envoyer l'email dans cet environnement." };
  return { ok: true };
}

const folderNameSchema = z.string().trim().min(1, "Le nom du dossier est requis.").max(150).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE);

export async function depositClientTimesheet(crmId: string, chantierId: string, weekStartIso: string, folderName: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await requireForeman(ctx, tenant, chantierId);
  const parsedFolder = folderNameSchema.safeParse(folderName);
  if (!parsedFolder.success) return { ok: false, error: parsedFolder.error.issues[0]?.message ?? "Nom de dossier invalide." };

  const rendered = await buildClientTimesheetPdf(tenant, ctx, chantierId, weekStartIso);
  if (!rendered) return { ok: false, error: "Aucune fiche salarié saisie pour cette semaine sur ce chantier." };

  const fileName = `Pointage client S${rendered.weekNumber} - ${rendered.chantierName}.pdf`;
  const driver = getStorageDriver();
  const { storageKey } = await driver.put({ buffer: rendered.buffer, fileName, crmId: tenant.crmId, mimeType: "application/pdf" });
  const folderId = await findOrCreateRootFolder(tenant.crmId, ctx.user.id, parsedFolder.data, ctx.user.id);

  await prisma.vaultDocument.create({
    data: {
      crmId: tenant.crmId,
      userId: ctx.user.id,
      fileName,
      mimeType: "application/pdf",
      size: rendered.buffer.length,
      storageKey,
      category: VaultDocumentCategory.TIMESHEET_CLIENT,
      folderId,
      // Idem : la semaine couverte (et non la date de dépôt) et le chantier.
      periodStart: rendered.weekStart,
      chantierId,
      uploadedById: ctx.user.id,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pointage.client_sheet_deposited",
    entityType: "POINTAGE",
    entityId: chantierId,
    newValue: { folder: parsedFolder.data },
  });
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath(`/c/${tenant.crmSlug}/pointage-client`);
  return { ok: true };
}

/**
 * Fiches de pointage (salariés + client) déjà déposées au coffre-fort pour
 * ce chantier et cette semaine — pour permettre au chef de chantier de
 * repérer et corriger un dépôt fait par erreur. Repose sur le même libellé
 * de dossier ("date — chantier") que depositEmployeeTimesheets ; ne
 * retrouve une fiche client que si son dossier n'a pas été renommé par le
 * chef de chantier au moment du dépôt.
 */
export async function listTimesheetDepositsForWeek(crmId: string, chantierId: string, weekStartIso: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) throw new AuthError("CRM_ACCESS_DENIED", "Chantier introuvable.");
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");
  await requireForeman(ctx, tenant, chantierId);

  const weekStart = mondayOf(new Date(weekStartIso));
  const folderName = `${weekStart.toLocaleDateString("fr-FR")} — ${chantier.name}`;

  const docs = await prisma.vaultDocument.findMany({
    where: {
      crmId: tenant.crmId,
      folder: { name: folderName },
      category: { in: [VaultDocumentCategory.TIMESHEET_EMPLOYEE, VaultDocumentCategory.TIMESHEET_CLIENT] },
    },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { firstName: true, lastName: true } } },
  });

  return docs.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    category: d.category,
    createdAt: d.createdAt,
    employeeName: d.category === VaultDocumentCategory.TIMESHEET_EMPLOYEE ? `${d.user.firstName} ${d.user.lastName}` : null,
  }));
}

/**
 * Supprime une fiche de pointage (salarié ou client) du coffre-fort, en cas
 * d'erreur de dépôt. Réservé aux administrateurs et aux chefs de chantier
 * du CRM concerné — jamais aux autres catégories de documents (fiches de
 * paie, documents personnels...), qui restent gérées via le coffre-fort
 * standard (permission MANAGE_SETTINGS).
 */
export async function deleteTimesheetDocument(crmId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);

  const doc = await prisma.vaultDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { ok: false, error: "Document introuvable." };
  assertBelongsToCrm(doc.crmId, tenant, "Document");
  if (doc.category !== VaultDocumentCategory.TIMESHEET_EMPLOYEE && doc.category !== VaultDocumentCategory.TIMESHEET_CLIENT) {
    return { ok: false, error: "Cette action ne concerne que les fiches de pointage." };
  }
  if (!tenant.isGlobalAdmin && !isTransverseCategory(tenant.category)) {
    const isForeman = await getIsForeman(ctx.user.id, tenant.crmId);
    if (!isForeman) return { ok: false, error: "Réservé aux chefs de chantier et aux administrateurs." };
  }

  await getStorageDriver().remove(doc.storageKey);
  await prisma.vaultDocument.delete({ where: { id: documentId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pointage.timesheet_document_deleted",
    entityType: "VAULT_DOCUMENT",
    entityId: documentId,
    oldValue: { fileName: doc.fileName, category: doc.category, forUserId: doc.userId },
  });
  revalidatePath(`/c/${tenant.crmSlug}/pointage-salaries`);
  revalidatePath(`/c/${tenant.crmSlug}/pointage-client`);
  revalidatePath(`/c/${tenant.crmSlug}/vault`);
  revalidatePath("/admin/vault");
  return { ok: true };
}
