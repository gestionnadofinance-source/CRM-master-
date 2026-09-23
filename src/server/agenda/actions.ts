"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { notifyCrm } from "@/server/notifications/create";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { AppointmentStatus } from "@prisma/client";
import { advanceProspectOpportunityStage } from "@/server/pipeline/actions";
import { removeStorageKeys } from "@/lib/storage";
import { MAX_CODE, MAX_ID, MAX_LONG, MAX_SHORT, MAX_TEXT, tooLong } from "@/lib/validation";

// ============================================================================
// Helpers
// ============================================================================

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

/** Vérifie qu'un utilisateur a bien accès à ce CRM avant de pouvoir lui
 * assigner un rendez-vous (propriétaire ou participant) : on ne fait jamais
 * confiance à un userId transmis par le client sans revérifier son accès. */
async function assertUserHasCrmAccess(userId: string, crmId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isGlobalAdmin: true, status: true } });
  if (!user || user.status !== "ACTIVE") throw new Error("Utilisateur invalide.");
  if (user.isGlobalAdmin) return;
  const access = await prisma.userCrmAccess.findUnique({ where: { userId_crmId: { userId, crmId } } });
  if (!access) throw new Error("Cet utilisateur n'a pas accès à ce CRM.");
}

export interface AgendaActionResult {
  ok: boolean;
  error?: string;
  appointmentId?: string;
}

// ============================================================================
// Lecture
// ============================================================================

const rangeSchema = z.object({
  start: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1),
  end: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1),
});

export async function listAppointmentsInRange(crmId: string, startISO: string, endISO: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  const { start, end } = rangeSchema.parse({ start: startISO, end: endISO });
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return [];

  return prisma.appointment.findMany({
    where: {
      crmId: tenant.crmId,
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
    },
    orderBy: { startAt: "asc" },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      client: { select: { id: true, company: true } },
      prospect: { select: { id: true, company: true } },
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, color: true } } } },
    },
  });
}

export async function getAppointmentDetail(crmId: string, appointmentId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      client: { select: { id: true, company: true } },
      prospect: { select: { id: true, company: true } },
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, color: true } } } },
    },
  });
  if (!appointment) return null;
  assertBelongsToCrm(appointment.crmId, tenant, "Rendez-vous");

  // "Historique" du rendez-vous ne montre que les 24 dernières heures.
  const [history, prep] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        crmId: tenant.crmId,
        appointmentId: appointment.id,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { firstName: true, lastName: true, color: true } } },
    }),
    buildPrepInfo(tenant.crmId, appointment.clientId, appointment.prospectId, appointment.id),
  ]);

  return { appointment, history, prep };
}

async function buildPrepInfo(
  crmId: string,
  clientId: string | null,
  prospectId: string | null,
  excludeAppointmentId: string
) {
  if (!clientId && !prospectId) return null;
  const entityFilter = clientId ? { clientId } : { prospectId };

  const [lastAppointment, lastQuote, recentActivity, opportunity, prospectRow] = await Promise.all([
    prisma.appointment.findFirst({
      where: { crmId, ...entityFilter, id: { not: excludeAppointmentId } },
      orderBy: { startAt: "desc" },
      select: { id: true, title: true, startAt: true, status: true },
    }),
    prisma.quote.findFirst({
      where: { crmId, ...entityFilter },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true, totalTtc: true, createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { crmId, ...entityFilter },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.opportunity.findFirst({
      where: { crmId, ...entityFilter },
      orderBy: { updatedAt: "desc" },
      select: { amount: true, nextAction: true },
    }),
    prospectId
      ? prisma.prospect.findUnique({ where: { id: prospectId }, select: { potentialAmount: true, nextContactAt: true } })
      : Promise.resolve(null),
  ]);

  const potentialAmount = opportunity?.amount
    ? Number(opportunity.amount)
    : prospectRow?.potentialAmount
      ? Number(prospectRow.potentialAmount)
      : null;

  return {
    lastAppointment,
    lastQuote,
    recentActivity,
    potentialAmount,
    nextAction: opportunity?.nextAction ?? null,
  };
}

export async function getClientOrProspectLabel(
  crmId: string,
  type: "client" | "prospect",
  id: string
): Promise<{ id: string; label: string; phone: string | null; email: string | null } | null> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  if (type === "client") {
    const c = await prisma.client.findUnique({
      where: { id },
      select: { id: true, crmId: true, company: true, phone: true, email: true },
    });
    if (!c || c.crmId !== tenant.crmId) return null;
    return { id: c.id, label: c.company, phone: c.phone, email: c.email };
  }
  const p = await prisma.prospect.findUnique({
    where: { id },
    select: { id: true, crmId: true, company: true, phone: true, email: true },
  });
  if (!p || p.crmId !== tenant.crmId) return null;
  return { id: p.id, label: p.company, phone: p.phone, email: p.email };
}

export async function searchClientsAndProspects(crmId: string, query: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  const q = query.trim();
  if (q.length < 2) return [];

  const [clients, prospects] = await Promise.all([
    prisma.client.findMany({
      where: { crmId: tenant.crmId, company: { contains: q, mode: "insensitive" } },
      select: { id: true, company: true },
      take: 8,
    }),
    // Un prospect converti a désormais sa propre fiche client : il ne doit
    // plus ressortir dans la recherche prospects, seulement côté clients.
    prisma.prospect.findMany({
      where: { crmId: tenant.crmId, company: { contains: q, mode: "insensitive" }, status: { not: "CONVERTED" } },
      select: { id: true, company: true },
      take: 8,
    }),
  ]);

  return [
    ...clients.map((c) => ({ type: "client" as const, id: c.id, label: c.company })),
    ...prospects.map((p) => ({ type: "prospect" as const, id: p.id, label: p.company })),
  ];
}

// ============================================================================
// Écriture
// ============================================================================

const appointmentInputSchema = z
  .object({
    title: z.string().trim().min(1, "Le titre est obligatoire.").max(200),
    clientId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).nullable(),
    prospectId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).nullable(),
    ownerId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).min(1, "Le commercial est obligatoire."),
    participantIds: z.array(z.string().max(MAX_ID, tooLong(MAX_ID))),
    startAt: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1, "La date de début est obligatoire."),
    endAt: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1, "La date de fin est obligatoire."),
    location: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
    phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
    email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
    notes: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  })
  .refine((d) => !(d.clientId && d.prospectId), {
    message: "Choisissez un client OU un prospect, pas les deux.",
  });

function parseAppointmentForm(formData: FormData) {
  const raw = {
    title: String(formData.get("title") ?? "").trim(),
    clientId: emptyToNull(formData.get("clientId")),
    prospectId: emptyToNull(formData.get("prospectId")),
    ownerId: String(formData.get("ownerId") ?? "").trim(),
    participantIds: formData.getAll("participantIds").map(String),
    startAt: String(formData.get("startAt") ?? "").trim(),
    endAt: String(formData.get("endAt") ?? "").trim(),
    location: emptyToNull(formData.get("location")),
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
    notes: emptyToNull(formData.get("notes")),
  };
  const parsed = appointmentInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return parsed.data;
}

export async function createAppointment(
  crmId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<AgendaActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const parsed = parseAppointmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const start = new Date(parsed.startAt);
  const end = new Date(parsed.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "Date invalide." };
  if (end <= start) return { ok: false, error: "L'heure de fin doit être après l'heure de début." };

  try {
    if (parsed.clientId) {
      const c = await prisma.client.findUnique({ where: { id: parsed.clientId }, select: { crmId: true } });
      if (!c || c.crmId !== tenant.crmId) return { ok: false, error: "Client introuvable dans ce CRM." };
    }
    if (parsed.prospectId) {
      const p = await prisma.prospect.findUnique({ where: { id: parsed.prospectId }, select: { crmId: true } });
      if (!p || p.crmId !== tenant.crmId) return { ok: false, error: "Prospect introuvable dans ce CRM." };
    }
    await assertUserHasCrmAccess(parsed.ownerId, tenant.crmId);
    const participantIds = Array.from(new Set(parsed.participantIds.filter((id) => id && id !== parsed.ownerId)));
    for (const id of participantIds) await assertUserHasCrmAccess(id, tenant.crmId);

    const appointment = await prisma.appointment.create({
      data: {
        crmId: tenant.crmId,
        title: parsed.title,
        clientId: parsed.clientId,
        prospectId: parsed.prospectId,
        ownerId: parsed.ownerId,
        startAt: start,
        endAt: end,
        location: parsed.location,
        phone: parsed.phone,
        email: parsed.email,
        notes: parsed.notes,
        participants: { create: participantIds.map((userId) => ({ userId })) },
      },
    });

    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "appointment.created",
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      appointmentId: appointment.id,
      clientId: parsed.clientId ?? undefined,
      prospectId: parsed.prospectId ?? undefined,
      newValue: { title: parsed.title, startAt: start.toISOString() },
    });
    await notifyCrm({
      crmId: tenant.crmId,
      type: "APPOINTMENT_CREATED",
      title: `Nouveau rendez-vous : ${parsed.title}`,
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      actorId: ctx.user.id,
      excludeUserIds: [ctx.user.id],
    });
    await publishToCrm(tenant.crmId, "appointment.upserted", { id: appointment.id });
    revalidatePath(`/c/${tenant.crmSlug}/agenda`);

    if (parsed.prospectId) {
      await advanceProspectOpportunityStage(tenant.crmId, parsed.prospectId, "Rendez-vous", ctx.user.id);
      revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
    }

    return { ok: true, appointmentId: appointment.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur lors de la création." };
  }
}

export async function updateAppointment(
  crmId: string,
  appointmentId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<AgendaActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);

  const existing = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!existing) return { ok: false, error: "Rendez-vous introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Rendez-vous");

  const parsed = parseAppointmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const start = new Date(parsed.startAt);
  const end = new Date(parsed.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "Date invalide." };
  if (end <= start) return { ok: false, error: "L'heure de fin doit être après l'heure de début." };

  try {
    if (parsed.clientId) {
      const c = await prisma.client.findUnique({ where: { id: parsed.clientId }, select: { crmId: true } });
      if (!c || c.crmId !== tenant.crmId) return { ok: false, error: "Client introuvable dans ce CRM." };
    }
    if (parsed.prospectId) {
      const p = await prisma.prospect.findUnique({ where: { id: parsed.prospectId }, select: { crmId: true } });
      if (!p || p.crmId !== tenant.crmId) return { ok: false, error: "Prospect introuvable dans ce CRM." };
    }
    await assertUserHasCrmAccess(parsed.ownerId, tenant.crmId);
    const participantIds = Array.from(new Set(parsed.participantIds.filter((id) => id && id !== parsed.ownerId)));
    for (const id of participantIds) await assertUserHasCrmAccess(id, tenant.crmId);

    await prisma.$transaction([
      prisma.appointmentParticipant.deleteMany({ where: { appointmentId } }),
      prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          title: parsed.title,
          clientId: parsed.clientId,
          prospectId: parsed.prospectId,
          ownerId: parsed.ownerId,
          startAt: start,
          endAt: end,
          location: parsed.location,
          phone: parsed.phone,
          email: parsed.email,
          notes: parsed.notes,
          participants: { create: participantIds.map((userId) => ({ userId })) },
        },
      }),
    ]);

    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "appointment.updated",
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      appointmentId,
      clientId: parsed.clientId ?? undefined,
      prospectId: parsed.prospectId ?? undefined,
      oldValue: { title: existing.title, startAt: existing.startAt.toISOString() },
      newValue: { title: parsed.title, startAt: start.toISOString() },
    });
    await notifyCrm({
      crmId: tenant.crmId,
      type: "APPOINTMENT_UPDATED",
      title: `Rendez-vous modifié : ${parsed.title}`,
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      actorId: ctx.user.id,
      excludeUserIds: [ctx.user.id],
    });
    await publishToCrm(tenant.crmId, "appointment.upserted", { id: appointmentId });
    revalidatePath(`/c/${tenant.crmSlug}/agenda`);

    if (parsed.prospectId) {
      await advanceProspectOpportunityStage(tenant.crmId, parsed.prospectId, "Rendez-vous", ctx.user.id);
      revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
    }

    return { ok: true, appointmentId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erreur lors de la modification." };
  }
}

export async function updateAppointmentStatus(
  crmId: string,
  appointmentId: string,
  status: AppointmentStatus,
  actorCtx?: AuthContext
): Promise<AgendaActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  const existing = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!existing) return { ok: false, error: "Rendez-vous introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Rendez-vous");

  if (!Object.values(AppointmentStatus).includes(status)) return { ok: false, error: "Statut invalide." };

  await prisma.appointment.update({ where: { id: appointmentId }, data: { status } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "appointment.status_changed",
    entityType: "APPOINTMENT",
    entityId: appointmentId,
    appointmentId,
    clientId: existing.clientId ?? undefined,
    prospectId: existing.prospectId ?? undefined,
    oldValue: { status: existing.status },
    newValue: { status },
  });
  await publishToCrm(tenant.crmId, "appointment.upserted", { id: appointmentId });
  revalidatePath(`/c/${tenant.crmSlug}/agenda`);
  return { ok: true, appointmentId };
}

export async function deleteAppointment(
  crmId: string,
  appointmentId: string,
  actorCtx?: AuthContext
): Promise<AgendaActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const existing = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!existing) return { ok: false, error: "Rendez-vous introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Rendez-vous");

  // Document.appointmentId est en onDelete: Cascade — les lignes seront
  // supprimées automatiquement, mais pas les fichiers physiques : à
  // effacer explicitement avant, sans quoi ils restent orphelins.
  const appointmentDocs = await prisma.document.findMany({ where: { appointmentId }, select: { storageKey: true } });
  await removeStorageKeys(appointmentDocs.map((d) => d.storageKey));

  await prisma.appointment.delete({ where: { id: appointmentId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "appointment.deleted",
    entityType: "APPOINTMENT",
    entityId: appointmentId,
    clientId: existing.clientId ?? undefined,
    prospectId: existing.prospectId ?? undefined,
    oldValue: { title: existing.title },
  });
  await publishToCrm(tenant.crmId, "appointment.deleted", { id: appointmentId });
  revalidatePath(`/c/${tenant.crmSlug}/agenda`);
  return { ok: true };
}

const reportInputSchema = z.object({
  reportSummary: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  reportNeeds: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  reportBudget: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  reportNextStep: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).nullable(),
  reportFollowUpAt: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  reportNotes: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  markCompleted: z.boolean(),
});

export async function submitAppointmentReport(
  crmId: string,
  appointmentId: string,
  formData: FormData
): Promise<AgendaActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_APPOINTMENTS);
  const existing = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!existing) return { ok: false, error: "Rendez-vous introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Rendez-vous");

  const raw = {
    reportSummary: emptyToNull(formData.get("reportSummary")),
    reportNeeds: emptyToNull(formData.get("reportNeeds")),
    reportBudget: emptyToNull(formData.get("reportBudget")),
    reportNextStep: emptyToNull(formData.get("reportNextStep")),
    reportFollowUpAt: emptyToNull(formData.get("reportFollowUpAt")),
    reportNotes: emptyToNull(formData.get("reportNotes")),
    markCompleted: formData.get("markCompleted") === "on",
  };
  const parsed = reportInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  const followUpAt = parsed.data.reportFollowUpAt ? new Date(parsed.data.reportFollowUpAt) : null;
  if (followUpAt && Number.isNaN(followUpAt.getTime())) return { ok: false, error: "Date de relance invalide." };

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      reportSummary: parsed.data.reportSummary,
      reportNeeds: parsed.data.reportNeeds,
      reportBudget: parsed.data.reportBudget,
      reportNextStep: parsed.data.reportNextStep,
      reportFollowUpAt: followUpAt,
      reportNotes: parsed.data.reportNotes,
      status: parsed.data.markCompleted ? "COMPLETED" : existing.status,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "appointment.report_submitted",
    entityType: "APPOINTMENT",
    entityId: appointmentId,
    appointmentId,
    clientId: existing.clientId ?? undefined,
    prospectId: existing.prospectId ?? undefined,
    newValue: { reportSummary: parsed.data.reportSummary },
  });
  await publishToCrm(tenant.crmId, "appointment.upserted", { id: appointmentId });
  revalidatePath(`/c/${tenant.crmSlug}/agenda`);
  return { ok: true, appointmentId };
}
