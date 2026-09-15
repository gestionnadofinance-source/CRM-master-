"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { AvailabilityExceptionType } from "@prisma/client";

export interface AvailabilityActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Un utilisateur peut toujours gérer sa propre disponibilité. Gérer la
 * disponibilité d'un autre utilisateur du CRM exige la permission
 * MANAGE_APPOINTMENTS (rôle manager élargi).
 */
async function assertCanEditAvailability(
  ctxUserId: string,
  targetUserId: string,
  crmId: string,
  permissions: Set<Permission>
): Promise<void> {
  if (targetUserId === ctxUserId) return;
  if (!permissions.has(Permission.MANAGE_APPOINTMENTS)) {
    throw new Error("Vous n'avez pas le droit de modifier la disponibilité d'un autre utilisateur.");
  }
  const access = await prisma.userCrmAccess.findUnique({ where: { userId_crmId: { userId: targetUserId, crmId } } });
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { isGlobalAdmin: true } });
  if (!access && !targetUser?.isGlobalAdmin) {
    throw new Error("Cet utilisateur n'a pas accès à ce CRM.");
  }
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ============================================================================
// AvailabilityRule (créneaux hebdomadaires récurrents)
// ============================================================================

export async function listAvailabilityRules(crmId: string, userId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  return prisma.availabilityRule.findMany({
    where: { crmId: tenant.crmId, userId },
    orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
  });
}

const ruleInputSchema = z
  .object({
    userId: z.string().trim().min(1),
    weekday: z.coerce.number().int().min(0).max(6),
    startTime: z.string().regex(timePattern, "Heure de début invalide (HH:MM)."),
    endTime: z.string().regex(timePattern, "Heure de fin invalide (HH:MM)."),
  })
  .refine((d) => d.startTime < d.endTime, { message: "L'heure de fin doit être après l'heure de début." });

export async function addAvailabilityRule(crmId: string, formData: FormData): Promise<AvailabilityActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const raw = {
    userId: String(formData.get("userId") ?? "").trim(),
    weekday: formData.get("weekday"),
    startTime: String(formData.get("startTime") ?? "").trim(),
    endTime: String(formData.get("endTime") ?? "").trim(),
  };
  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await assertCanEditAvailability(ctx.user.id, parsed.data.userId, tenant.crmId, tenant.permissions);

    const existing = await prisma.availabilityRule.findMany({
      where: { crmId: tenant.crmId, userId: parsed.data.userId, weekday: parsed.data.weekday },
    });
    const overlap = existing.some(
      (r) => parsed.data.startTime < r.endTime && r.startTime < parsed.data.endTime
    );
    if (overlap) return { ok: false, error: "Ce créneau chevauche un créneau déjà défini pour ce jour." };

    await prisma.availabilityRule.create({
      data: {
        crmId: tenant.crmId,
        userId: parsed.data.userId,
        weekday: parsed.data.weekday,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
      },
    });

    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "availability_rule.created",
      entityType: "AVAILABILITY_RULE",
    });
    await publishToCrm(tenant.crmId, "notification.created", { kind: "availability" });
    revalidatePath(`/c/${tenant.crmSlug}/booking`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur." };
  }
}

export async function deleteAvailabilityRule(crmId: string, ruleId: string): Promise<AvailabilityActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const rule = await prisma.availabilityRule.findUnique({ where: { id: ruleId } });
  if (!rule) return { ok: false, error: "Créneau introuvable." };
  assertBelongsToCrm(rule.crmId, tenant, "Créneau de disponibilité");

  try {
    await assertCanEditAvailability(ctx.user.id, rule.userId, tenant.crmId, tenant.permissions);
    await prisma.availabilityRule.delete({ where: { id: ruleId } });
    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "availability_rule.deleted",
      entityType: "AVAILABILITY_RULE",
      entityId: ruleId,
    });
    revalidatePath(`/c/${tenant.crmSlug}/booking`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur." };
  }
}

// ============================================================================
// AvailabilityException (congés, jours fériés, indisponibilités, blocages)
// ============================================================================

export async function listAvailabilityExceptions(crmId: string, userId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  return prisma.availabilityException.findMany({
    where: { crmId: tenant.crmId, userId },
    orderBy: { startAt: "desc" },
  });
}

const exceptionInputSchema = z
  .object({
    userId: z.string().trim().min(1),
    type: z.nativeEnum(AvailabilityExceptionType),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
    allDay: z.boolean(),
    reason: z.string().trim().max(500).nullable(),
  })
  .refine((d) => new Date(d.startAt) <= new Date(d.endAt), {
    message: "La date de fin doit être après la date de début.",
  });

export async function addAvailabilityException(crmId: string, formData: FormData): Promise<AvailabilityActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const allDay = formData.get("allDay") === "on";
  const rawStart = String(formData.get("startAt") ?? "").trim();
  const rawEnd = String(formData.get("endAt") ?? "").trim();
  const raw = {
    userId: String(formData.get("userId") ?? "").trim(),
    type: String(formData.get("type") ?? "UNAVAILABLE") as AvailabilityExceptionType,
    startAt: allDay ? `${rawStart}T00:00:00` : rawStart,
    endAt: allDay ? `${rawEnd || rawStart}T23:59:59` : rawEnd,
    allDay,
    reason: formData.get("reason") == null || String(formData.get("reason")).trim() === "" ? null : String(formData.get("reason")).trim(),
  };
  const parsed = exceptionInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  const start = new Date(parsed.data.startAt);
  const end = new Date(parsed.data.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "Date invalide." };

  try {
    await assertCanEditAvailability(ctx.user.id, parsed.data.userId, tenant.crmId, tenant.permissions);

    await prisma.availabilityException.create({
      data: {
        crmId: tenant.crmId,
        userId: parsed.data.userId,
        type: parsed.data.type,
        startAt: start,
        endAt: end,
        allDay: parsed.data.allDay,
        reason: parsed.data.reason,
      },
    });

    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "availability_exception.created",
      entityType: "AVAILABILITY_EXCEPTION",
      newValue: { type: parsed.data.type, startAt: start.toISOString(), endAt: end.toISOString() },
    });
    revalidatePath(`/c/${tenant.crmSlug}/booking`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur." };
  }
}

export async function deleteAvailabilityException(crmId: string, exceptionId: string): Promise<AvailabilityActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const exception = await prisma.availabilityException.findUnique({ where: { id: exceptionId } });
  if (!exception) return { ok: false, error: "Exception introuvable." };
  assertBelongsToCrm(exception.crmId, tenant, "Exception de disponibilité");

  try {
    await assertCanEditAvailability(ctx.user.id, exception.userId, tenant.crmId, tenant.permissions);
    await prisma.availabilityException.delete({ where: { id: exceptionId } });
    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "availability_exception.deleted",
      entityType: "AVAILABILITY_EXCEPTION",
      entityId: exceptionId,
    });
    revalidatePath(`/c/${tenant.crmSlug}/booking`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur." };
  }
}

// ============================================================================
// Visibilité des rendez-vous issus de la réservation publique
// ============================================================================

export async function listPublicBookingAppointments(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  return prisma.appointment.findMany({
    where: { crmId: tenant.crmId, isPublicBooking: true },
    orderBy: { startAt: "desc" },
    take: 30,
    include: { owner: { select: { firstName: true, lastName: true, color: true } } },
  });
}
