"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { depositMissionOrderCore } from "@/server/mission-order/core";
import {
  revalidatePlanning,
  createChantierCore,
  updateChantierCore,
  deleteChantierCore,
} from "@/server/planning/core";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { MAX_ID, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

export type { ActionResult } from "@/server/planning/core";
import type { ActionResult } from "@/server/planning/core";

const decimalField = z.coerce.number().min(0).max(99999.99).optional().or(z.literal("").transform(() => undefined));

/** Adaptateurs "use server" : résolvent la session, puis délèguent au cœur. */
export async function createChantier(crmId: string, formData: FormData): Promise<ActionResult> {
  return createChantierCore(await requireAuth(), crmId, formData);
}

export async function updateChantier(crmId: string, chantierId: string, formData: FormData): Promise<ActionResult> {
  return updateChantierCore(await requireAuth(), crmId, chantierId, formData);
}

export async function deleteChantier(crmId: string, chantierId: string): Promise<ActionResult> {
  return deleteChantierCore(await requireAuth(), crmId, chantierId);
}

/**
 * Le planning est consultable depuis deux pages distinctes : la vue par
 * CRM (/c/[crmSlug]/planning) et la vue transverse admin
 * (/admin/planning?crm=...). N'invalider que la première laissait la
 * seconde afficher des chantiers périmés (créés/modifiés ailleurs) tant
 * qu'on n'y rechargeait pas la page entièrement — d'où l'obligation de
 * toujours invalider les deux après toute mutation.
 */

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

  // L'ordre de mission suit l'affectation, automatiquement : il était
  // jusqu'ici derrière un bouton à cliquer salarié par salarié, et un ouvrier
  // affecté sans que personne y pense n'en recevait jamais. Best-effort : le
  // rendu d'un PDF ne doit pas faire échouer l'affectation elle-même.
  try {
    const depot = await depositMissionOrderCore(tenant, ctx.user.id, chantierId, chantier.name, parsed.data.userId);
    if (!depot.ok) console.warn(`[planning] ordre de mission non déposé : ${depot.error}`);
  } catch (err) {
    console.error("[planning] échec du dépôt de l'ordre de mission", err);
  }

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
