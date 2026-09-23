"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { MAX_ID, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
  chantierId?: string;
}

/**
 * Le planning est consultable depuis deux pages distinctes : la vue par
 * CRM (/c/[crmSlug]/planning) et la vue transverse admin
 * (/admin/planning?crm=...). N'invalider que la première laissait la
 * seconde afficher des chantiers périmés (créés/modifiés ailleurs) tant
 * qu'on n'y rechargeait pas la page entièrement — d'où l'obligation de
 * toujours invalider les deux après toute mutation.
 */
function revalidatePlanning(crmSlug: string): void {
  revalidatePath(`/c/${crmSlug}/planning`);
  revalidatePath("/admin/planning");
}

const decimalField = z.coerce.number().min(0).max(99999.99).optional().or(z.literal("").transform(() => undefined));

const chantierSchema = z.object({
  name: z.string().trim().min(1, "Le nom du chantier est requis.").max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  description: z.string().trim().max(2000).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  address: z.string().trim().max(300).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED"]).optional(),

  lunchAllowance: decimalField,
  dinnerAllowance: decimalField,
  travelAllowance: decimalField,
  maskBonus: decimalField,
  managementBonus: decimalField,
  zoneBonus: decimalField,
  postBonus: decimalField,
  mealAllowance: decimalField,
  clothingBonus: decimalField,

  missionNature: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  clientName: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  siteContactName: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  siteContactPhone: z.string().trim().max(50).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  importantDocuments: z.string().trim().max(1000).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
});

/**
 * Vue d'administration (rôle MANAGER/USER, catégorie SECRETAIRE, ou
 * administrateur global) : tous les chantiers du CRM, pour pouvoir
 * affecter qui que ce soit. Vue Ouvrier : uniquement les chantiers
 * auxquels la personne est elle-même affectée — jamais les données de
 * planning des autres, ni des chantiers où elle n'intervient pas.
 */
export async function listChantiers(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  const isOuvrier = tenant.category === "OUVRIER" && !tenant.isGlobalAdmin;
  const chantiers = await prisma.chantier.findMany({
    where: isOuvrier
      ? { crmId: tenant.crmId, assignments: { some: { userId: ctx.user.id } } }
      : { crmId: tenant.crmId },
    orderBy: { startDate: "asc" },
    include: {
      assignments: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              color: true,
              crmAccess: { where: { crmId: tenant.crmId }, take: 1, select: { isForeman: true } },
            },
          },
        },
      },
    },
  });
  // Les champs Decimal de Prisma ne sont pas des objets simples : ils ne
  // peuvent pas traverser la frontière Server → Client Component tels
  // quels (voir les autres modules, ex. src/server/pointage/actions.ts).
  return chantiers.map((c) => ({
    ...c,
    lunchAllowance: Number(c.lunchAllowance),
    dinnerAllowance: Number(c.dinnerAllowance),
    travelAllowance: Number(c.travelAllowance),
    maskBonus: Number(c.maskBonus),
    managementBonus: Number(c.managementBonus),
    zoneBonus: Number(c.zoneBonus),
    postBonus: Number(c.postBonus),
    mealAllowance: Number(c.mealAllowance),
    clothingBonus: Number(c.clothingBonus),
    assignments: c.assignments.map((a) => ({
      ...a,
      kmRate: a.kmRate === null ? null : Number(a.kmRate),
      distanceKm: a.distanceKm === null ? null : Number(a.distanceKm),
      travelHourlyRate: a.travelHourlyRate === null ? null : Number(a.travelHourlyRate),
      travelDurationHours: a.travelDurationHours === null ? null : Number(a.travelDurationHours),
      sncfExpense: a.sncfExpense === null ? null : Number(a.sncfExpense),
      roomDeduction: a.roomDeduction === null ? null : Number(a.roomDeduction),
    })),
  }));
}

/** Liste des membres du CRM assignables à un chantier (utilisée par le formulaire d'affectation, admin uniquement). */
export async function listCrmMembersForPlanning(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  const access = await prisma.userCrmAccess.findMany({
    where: { crmId: tenant.crmId },
    include: { user: { select: { id: true, firstName: true, lastName: true, color: true, status: true } } },
    orderBy: { user: { firstName: "asc" } },
  });
  return access
    .filter((a) => a.user.status === "ACTIVE")
    .map((a) => ({ ...a.user, category: a.category, isForeman: a.isForeman }));
}

export async function createChantier(crmId: string, formData: FormData, actorCtx?: AuthContext): Promise<ActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const parsed = chantierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: "La date de fin doit être postérieure à la date de début." };
  }

  const chantier = await prisma.chantier.create({
    data: {
      crmId: tenant.crmId,
      name: parsed.data.name,
      description: parsed.data.description || undefined,
      address: parsed.data.address || undefined,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      color: parsed.data.color ?? "#0891b2",
      createdById: ctx.user.id,
      lunchAllowance: parsed.data.lunchAllowance ?? 0,
      dinnerAllowance: parsed.data.dinnerAllowance ?? 0,
      travelAllowance: parsed.data.travelAllowance ?? 0,
      maskBonus: parsed.data.maskBonus ?? 0,
      managementBonus: parsed.data.managementBonus ?? 0,
      zoneBonus: parsed.data.zoneBonus ?? 0,
      postBonus: parsed.data.postBonus ?? 0,
      mealAllowance: parsed.data.mealAllowance ?? 9.81,
      clothingBonus: parsed.data.clothingBonus ?? 0,
      missionNature: parsed.data.missionNature || undefined,
      clientName: parsed.data.clientName || undefined,
      siteContactName: parsed.data.siteContactName || undefined,
      siteContactPhone: parsed.data.siteContactPhone || undefined,
      importantDocuments: parsed.data.importantDocuments || undefined,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.created",
    entityType: "CHANTIER",
    entityId: chantier.id,
    newValue: { name: chantier.name },
  });
  await publishToCrm(tenant.crmId, "notification.created", { kind: "chantier", entityId: chantier.id });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true, chantierId: chantier.id };
}

export async function updateChantier(
  crmId: string,
  chantierId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<ActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const existing = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!existing) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Chantier");

  const parsed = chantierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: "La date de fin doit être postérieure à la date de début." };
  }

  await prisma.chantier.update({
    where: { id: chantierId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      address: parsed.data.address || null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      color: parsed.data.color ?? existing.color,
      status: parsed.data.status ?? existing.status,
      lunchAllowance: parsed.data.lunchAllowance ?? 0,
      dinnerAllowance: parsed.data.dinnerAllowance ?? 0,
      travelAllowance: parsed.data.travelAllowance ?? 0,
      maskBonus: parsed.data.maskBonus ?? 0,
      managementBonus: parsed.data.managementBonus ?? 0,
      zoneBonus: parsed.data.zoneBonus ?? 0,
      postBonus: parsed.data.postBonus ?? 0,
      mealAllowance: parsed.data.mealAllowance ?? 9.81,
      clothingBonus: parsed.data.clothingBonus ?? 0,
      missionNature: parsed.data.missionNature || null,
      clientName: parsed.data.clientName || null,
      siteContactName: parsed.data.siteContactName || null,
      siteContactPhone: parsed.data.siteContactPhone || null,
      importantDocuments: parsed.data.importantDocuments || null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.updated",
    entityType: "CHANTIER",
    entityId: chantierId,
  });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}

export async function deleteChantier(crmId: string, chantierId: string, actorCtx?: AuthContext): Promise<ActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireOperationsAccess(ctx, crmId);

  const existing = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!existing) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Chantier");

  await prisma.chantier.delete({ where: { id: chantierId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.deleted",
    entityType: "CHANTIER",
    entityId: chantierId,
    oldValue: { name: existing.name },
  });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}

const assignSchema = z.object({
  userId: z.string().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Sélectionnez une personne."),
  startDate: z.coerce.date().optional().or(z.literal("").transform(() => undefined)),
  endDate: z.coerce.date().optional().or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),

  workerAddress: z.string().trim().max(300).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  kmRate: decimalField,
  distanceKm: decimalField,
  travelHourlyRate: decimalField,
  travelDurationHours: decimalField,
  sncfExpense: decimalField,
  roomDeduction: decimalField,
});

export async function assignToChantier(crmId: string, chantierId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");

  const parsed = assignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const member = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: parsed.data.userId, crmId: tenant.crmId } },
  });
  if (!member) return { ok: false, error: "Cette personne n'a pas accès à ce CRM." };

  await prisma.chantierAssignment.upsert({
    where: { chantierId_userId: { chantierId, userId: parsed.data.userId } },
    create: {
      chantierId,
      userId: parsed.data.userId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      note: parsed.data.note || undefined,
      workerAddress: parsed.data.workerAddress || undefined,
      kmRate: parsed.data.kmRate,
      distanceKm: parsed.data.distanceKm,
      travelHourlyRate: parsed.data.travelHourlyRate,
      travelDurationHours: parsed.data.travelDurationHours,
      sncfExpense: parsed.data.sncfExpense,
      roomDeduction: parsed.data.roomDeduction,
    },
    update: {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      note: parsed.data.note || null,
      workerAddress: parsed.data.workerAddress || null,
      kmRate: parsed.data.kmRate ?? null,
      distanceKm: parsed.data.distanceKm ?? null,
      travelHourlyRate: parsed.data.travelHourlyRate ?? null,
      travelDurationHours: parsed.data.travelDurationHours ?? null,
      sncfExpense: parsed.data.sncfExpense ?? null,
      roomDeduction: parsed.data.roomDeduction ?? null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.assignment_updated",
    entityType: "CHANTIER",
    entityId: chantierId,
  });
  await publishToCrm(tenant.crmId, "notification.created", { kind: "chantier_assignment", entityId: chantierId });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}

export async function removeAssignment(crmId: string, chantierId: string, userId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");

  await prisma.chantierAssignment.deleteMany({ where: { chantierId, userId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.assignment_removed",
    entityType: "CHANTIER",
    entityId: chantierId,
  });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}
