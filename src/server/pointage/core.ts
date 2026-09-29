import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm, type TenantContext } from "@/server/tenant";
import { isTransverseCategory } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { revalidatePath } from "next/cache";
import { mondayOf, type PointageDay } from "@/server/pointage/calc";
import { MAX_CODE, MAX_ID, MAX_LONG, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

/**
 * Cœur de la saisie de pointage et helpers d'autorisation partagés, SANS
 * contrôle d'accès embarqué au niveau du contexte : chaque cœur reçoit un
 * AuthContext DÉJÀ établi.
 *
 * Vit hors du module "use server" à dessein : là-bas, tout export est une
 * action appelable depuis le navigateur avec des arguments arbitraires, donc
 * un paramètre de contexte y serait forgeable — un client pourrait se faire
 * passer pour un administrateur. Le contexte n'est légitime que construit
 * côté serveur (session vérifiée, ou clé API de l'API publique).
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Renseigné par les cœurs d'upsert, pour que l'API publique réponde 201 ou 200. */
  created?: boolean;
}

/**
 * "Chef de chantier" est un profil de la personne (UserCrmAccess.isForeman,
 * choisi à la création/l'édition de l'utilisateur — voir
 * src/app/admin/users), pas un rôle propre à chaque chantier : un chef de
 * chantier gère la feuille de pointage de tout chantier auquel il est
 * affecté (ChantierAssignment), sans distinction supplémentaire.
 */
export async function getIsForeman(userId: string, crmId: string): Promise<boolean> {
  const access = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId, crmId } },
    select: { isForeman: true },
  });
  return access?.isForeman ?? false;
}


/**
 * Un chef de chantier n'a de droits de saisie QUE sur les chantiers
 * auxquels il est effectivement affecté (voir ChantierAssignment) — jamais
 * sur la base de sa seule catégorie OUVRIER, ni sur un chantier auquel il
 * n'appartient pas. Un administrateur global, ou un accès de catégorie
 * SECRETAIRE ("accès total admin" hors données commerciales — voir
 * prisma/schema.prisma AccessCategory), contourne cette vérification comme
 * partout ailleurs dans l'application.
 */
export async function requireForeman(ctx: AuthContext, tenant: TenantContext, chantierId: string): Promise<void> {
  if (tenant.isGlobalAdmin || isTransverseCategory(tenant.category)) return;
  const isForeman = await getIsForeman(ctx.user.id, tenant.crmId);
  if (!isForeman) {
    throw new AuthError("FORBIDDEN", "Vous n'êtes pas chef de chantier.");
  }
  const assignment = await prisma.chantierAssignment.findUnique({
    where: { chantierId_userId: { chantierId, userId: ctx.user.id } },
  });
  if (!assignment) {
    throw new AuthError("FORBIDDEN", "Vous n'êtes pas affecté à ce chantier.");
  }
}


export function toDayArray(value: unknown): PointageDay[] {
  if (!Array.isArray(value)) return [];
  return value.map((d) => ({
    date: String((d as Record<string, unknown>).date ?? ""),
    normal: Number((d as Record<string, unknown>).normal) || 0,
    matin: Number((d as Record<string, unknown>).matin) || 0,
    apresMidi: Number((d as Record<string, unknown>).apresMidi) || 0,
    nuit: Number((d as Record<string, unknown>).nuit) || 0,
  }));
}


const boolField = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const upsertSchema = z.object({
  employeeId: z.string().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  weekStart: z.string().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  days: z.string().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  housingAllowance: z.coerce.number().min(0).max(10000).default(0),
  dirtAllowance: z.coerce.number().min(0).max(10000).default(0),
  hourlyRate: z.coerce.number().min(0).max(1000).default(0),
  nightRatePercent: z.coerce.number().min(0).max(500).default(0),
  lunchAllowanceApplied: boolField,
  dinnerAllowanceApplied: boolField,
  travelAllowanceApplied: boolField,
  maskBonusApplied: boolField,
  managementBonusApplied: boolField,
  zoneBonusApplied: boolField,
  postBonusApplied: boolField,
  kmReimbursementApplied: boolField,
  travelHoursReimbursementApplied: boolField,
  mealAllowanceApplied: boolField,
  clothingBonusApplied: boolField,
  // Nombres de grands déplacements de la semaine, par barème. Bornés à 7 :
  // c'est une feuille hebdomadaire, on ne peut pas en compter plus que de
  // jours. Sans ces deux champs, les colonnes existaient en base et étaient
  // lues par l'export Silae, mais RIEN ne les écrivait : les deux rubriques
  // restaient à zéro et n'apparaissaient jamais dans le fichier.
  gdDepl53Count: z.coerce.number().int().min(0).max(7).default(0),
  gdDepl80Count: z.coerce.number().int().min(0).max(7).default(0),
  comments: z.string().trim().max(2000).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
});


export async function upsertPointageEntryCore(
  ctx: AuthContext,
  crmId: string,
  chantierId: string,
  formData: FormData
): Promise<ActionResult> {
  const tenant = await requireCrmAccess(ctx, crmId);
  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");
  await requireForeman(ctx, tenant, chantierId);

  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };

  const weekStart = mondayOf(new Date(parsed.data.weekStart));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const member = await prisma.chantierAssignment.findUnique({
    where: { chantierId_userId: { chantierId, userId: parsed.data.employeeId } },
  });
  if (!member) return { ok: false, error: "Ce salarié n'est pas affecté à ce chantier." };
  // Même règle que côté affichage (listChantierRosterForWeek) : on ne peut
  // saisir des heures que sur une semaine où l'ouvrier est effectivement
  // mobilisé sur ce chantier d'après la période définie par l'admin.
  if (member.startDate && member.startDate > weekEnd) {
    return { ok: false, error: "Ce salarié n'est pas encore mobilisé sur ce chantier pour cette semaine." };
  }
  if (member.endDate && member.endDate < weekStart) {
    return { ok: false, error: "Ce salarié n'est plus mobilisé sur ce chantier pour cette semaine." };
  }

  let daysRaw: unknown;
  try {
    daysRaw = JSON.parse(parsed.data.days);
  } catch {
    return { ok: false, error: "Détail des heures invalide." };
  }
  const days = toDayArray(daysRaw);
  if (days.length !== 7) return { ok: false, error: "Détail des heures invalide." };
  for (const d of days) {
    if ([d.normal, d.matin, d.apresMidi, d.nuit].some((h) => h < 0 || h > 24)) {
      return { ok: false, error: "Une valeur d'heures est invalide (0 à 24)." };
    }
  }

  // L'API publique doit pouvoir distinguer une création d'une mise à jour
  // (201 ou 200) : Prisma ne le dit pas après coup, et comparer createdAt à
  // updatedAt serait faux dès que deux écritures tombent dans la même
  // milliseconde. Une lecture sur la clé unique tranche sans ambiguïté.
  const dejaSaisie = await prisma.pointage.findUnique({
    where: { chantierId_employeeId_weekStart: { chantierId, employeeId: parsed.data.employeeId, weekStart } },
    select: { id: true },
  });

  await prisma.pointage.upsert({
    where: { chantierId_employeeId_weekStart: { chantierId, employeeId: parsed.data.employeeId, weekStart } },
    create: {
      crmId: tenant.crmId,
      chantierId,
      employeeId: parsed.data.employeeId,
      foremanId: ctx.user.id,
      weekStart,
      days: days as unknown as object,
      housingAllowance: parsed.data.housingAllowance,
      dirtAllowance: parsed.data.dirtAllowance,
      hourlyRate: parsed.data.hourlyRate,
      nightRatePercent: parsed.data.nightRatePercent,
      lunchAllowanceApplied: parsed.data.lunchAllowanceApplied,
      dinnerAllowanceApplied: parsed.data.dinnerAllowanceApplied,
      travelAllowanceApplied: parsed.data.travelAllowanceApplied,
      maskBonusApplied: parsed.data.maskBonusApplied,
      managementBonusApplied: parsed.data.managementBonusApplied,
      zoneBonusApplied: parsed.data.zoneBonusApplied,
      postBonusApplied: parsed.data.postBonusApplied,
      kmReimbursementApplied: parsed.data.kmReimbursementApplied,
      travelHoursReimbursementApplied: parsed.data.travelHoursReimbursementApplied,
      mealAllowanceApplied: parsed.data.mealAllowanceApplied,
      clothingBonusApplied: parsed.data.clothingBonusApplied,
      gdDepl53Count: parsed.data.gdDepl53Count,
      gdDepl80Count: parsed.data.gdDepl80Count,
      comments: parsed.data.comments || null,
    },
    update: {
      foremanId: ctx.user.id,
      days: days as unknown as object,
      housingAllowance: parsed.data.housingAllowance,
      dirtAllowance: parsed.data.dirtAllowance,
      hourlyRate: parsed.data.hourlyRate,
      nightRatePercent: parsed.data.nightRatePercent,
      lunchAllowanceApplied: parsed.data.lunchAllowanceApplied,
      dinnerAllowanceApplied: parsed.data.dinnerAllowanceApplied,
      travelAllowanceApplied: parsed.data.travelAllowanceApplied,
      maskBonusApplied: parsed.data.maskBonusApplied,
      managementBonusApplied: parsed.data.managementBonusApplied,
      zoneBonusApplied: parsed.data.zoneBonusApplied,
      postBonusApplied: parsed.data.postBonusApplied,
      kmReimbursementApplied: parsed.data.kmReimbursementApplied,
      travelHoursReimbursementApplied: parsed.data.travelHoursReimbursementApplied,
      mealAllowanceApplied: parsed.data.mealAllowanceApplied,
      clothingBonusApplied: parsed.data.clothingBonusApplied,
      gdDepl53Count: parsed.data.gdDepl53Count,
      gdDepl80Count: parsed.data.gdDepl80Count,
      comments: parsed.data.comments || null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pointage.entry_saved",
    entityType: "POINTAGE",
    entityId: chantierId,
    newValue: { employeeId: parsed.data.employeeId, weekStart: weekStart.toISOString() },
  });
  revalidatePath(`/c/${tenant.crmSlug}/pointage-salaries`);
  return { ok: true, created: !dejaSaisie };
}


export async function deletePointageEntryCore(ctx: AuthContext, crmId: string, pointageId: string): Promise<ActionResult> {
  const tenant = await requireCrmAccess(ctx, crmId);
  const existing = await prisma.pointage.findUnique({ where: { id: pointageId } });
  if (!existing) return { ok: false, error: "Introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Pointage");
  await requireForeman(ctx, tenant, existing.chantierId);

  await prisma.pointage.delete({ where: { id: pointageId } });
  revalidatePath(`/c/${tenant.crmSlug}/pointage-salaries`);
  return { ok: true };
}
