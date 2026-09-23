"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { publishToCrm, publishToUser } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { TaskPriority, TaskStatus } from "@prisma/client";
import { listCrmMembers } from "@/server/shared/members";
import { MAX_CODE, MAX_ID, MAX_LONG, MAX_SHORT, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

// Les tâches sont un outil personnel/d'équipe courant : contrairement aux
// modules métier (clients, devis...), leur création/édition n'est PAS
// réservée à une permission dédiée — tout utilisateur ayant accès au CRM
// (requireCrmAccess sans argument `permission`) peut créer une tâche ou en
// modifier une. La suppression reste plus restreinte : réservée à
// l'auteur, à l'assigné, ou à un utilisateur disposant de Permission.DELETE.

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

const taskInputSchema = z.object({
  title: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le titre est obligatoire."),
  description: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  assigneeId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le responsable est obligatoire."),
  clientId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  prospectId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  quoteId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  appointmentId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  priority: z.nativeEnum(TaskPriority),
  status: z.nativeEnum(TaskStatus),
  dueAt: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
});

function parseTaskForm(formData: FormData) {
  const raw = {
    title: String(formData.get("title") ?? "").trim(),
    description: emptyToNull(formData.get("description")),
    assigneeId: String(formData.get("assigneeId") ?? "").trim(),
    clientId: emptyToNull(formData.get("clientId")),
    prospectId: emptyToNull(formData.get("prospectId")),
    quoteId: emptyToNull(formData.get("quoteId")),
    appointmentId: emptyToNull(formData.get("appointmentId")),
    priority: String(formData.get("priority") ?? "NORMAL") as TaskPriority,
    status: String(formData.get("status") ?? "TODO") as TaskStatus,
    dueAt: emptyToNull(formData.get("dueAt")),
  };
  const parsed = taskInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return parsed.data;
}

function parseDueAt(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface TaskActionResult {
  ok: boolean;
  error?: string;
  taskId?: string;
}

/** Vérifie que l'assigné et les entités liées appartiennent bien à ce CRM. */
async function validateReferences(
  crmId: string,
  input: { assigneeId: string; clientId: string | null; prospectId: string | null; quoteId: string | null; appointmentId: string | null }
): Promise<string | null> {
  const members = await listCrmMembers(crmId);
  if (!members.some((m) => m.id === input.assigneeId)) {
    return "Le responsable choisi n'appartient pas à ce CRM.";
  }
  if (input.clientId) {
    const c = await prisma.client.findUnique({ where: { id: input.clientId }, select: { crmId: true } });
    if (!c || c.crmId !== crmId) return "Client introuvable dans ce CRM.";
  }
  if (input.prospectId) {
    const p = await prisma.prospect.findUnique({ where: { id: input.prospectId }, select: { crmId: true } });
    if (!p || p.crmId !== crmId) return "Prospect introuvable dans ce CRM.";
  }
  if (input.quoteId) {
    const q = await prisma.quote.findUnique({ where: { id: input.quoteId }, select: { crmId: true } });
    if (!q || q.crmId !== crmId) return "Devis introuvable dans ce CRM.";
  }
  if (input.appointmentId) {
    const a = await prisma.appointment.findUnique({ where: { id: input.appointmentId }, select: { crmId: true } });
    if (!a || a.crmId !== crmId) return "Rendez-vous introuvable dans ce CRM.";
  }
  return null;
}

async function notifyAssigneeIfNeeded(
  crmId: string,
  actorId: string,
  assigneeId: string,
  taskId: string,
  title: string,
  verb: string
): Promise<void> {
  if (assigneeId === actorId) return; // pas besoin de se notifier soi-même
  try {
    await prisma.notification.create({
      data: {
        crmId,
        userId: assigneeId,
        actorId,
        type: "TASK_CREATED",
        title: `${verb} : ${title}`,
        entityType: "TASK",
        entityId: taskId,
      },
    });
    await publishToUser(assigneeId, "notification.created", { type: "TASK_CREATED", title });
  } catch (err) {
    console.error("[tasks] échec de notification de l'assigné", err);
  }
}

const rangeSchema = z.object({
  start: z.string().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  end: z.string().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
});

/**
 * Tâches ayant une échéance dans la période donnée — utilisé par l'agenda
 * pour afficher automatiquement les tâches à côté des rendez-vous, sans
 * dupliquer la donnée dans un Appointment séparé.
 */
export async function listTasksInRange(crmId: string, startISO: string, endISO: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  const { start, end } = rangeSchema.parse({ start: startISO, end: endISO });
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return [];

  return prisma.task.findMany({
    where: { crmId: tenant.crmId, dueAt: { gte: rangeStart, lte: rangeEnd } },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      assignee: { select: { id: true, firstName: true, lastName: true, color: true } },
    },
  });
}

export async function createTask(crmId: string, formData: FormData, actorCtx?: AuthContext): Promise<TaskActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId);

  const parsed = parseTaskForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const refError = await validateReferences(tenant.crmId, parsed);
  if (refError) return { ok: false, error: refError };

  const task = await prisma.task.create({
    data: {
      crmId: tenant.crmId,
      title: parsed.title,
      description: parsed.description,
      assigneeId: parsed.assigneeId,
      clientId: parsed.clientId,
      prospectId: parsed.prospectId,
      quoteId: parsed.quoteId,
      appointmentId: parsed.appointmentId,
      priority: parsed.priority,
      status: parsed.status,
      dueAt: parseDueAt(parsed.dueAt),
      createdById: ctx.user.id,
      isAutomated: false,
      completedAt: parsed.status === "DONE" ? new Date() : null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "task.created",
    entityType: "TASK",
    entityId: task.id,
    clientId: parsed.clientId ?? undefined,
    prospectId: parsed.prospectId ?? undefined,
    quoteId: parsed.quoteId ?? undefined,
    appointmentId: parsed.appointmentId ?? undefined,
    newValue: { title: task.title, assigneeId: task.assigneeId, status: task.status },
  });
  await publishToCrm(tenant.crmId, "task.upserted", { id: task.id });
  await notifyAssigneeIfNeeded(tenant.crmId, ctx.user.id, parsed.assigneeId, task.id, task.title, "Nouvelle tâche assignée");
  revalidatePath(`/c/${tenant.crmSlug}/tasks`);

  return { ok: true, taskId: task.id };
}

export async function updateTask(
  crmId: string,
  taskId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<TaskActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId);

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) return { ok: false, error: "Tâche introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Tâche");

  const parsed = parseTaskForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const refError = await validateReferences(tenant.crmId, parsed);
  if (refError) return { ok: false, error: refError };

  const wasDone = existing.status === "DONE";
  const isNowDone = parsed.status === "DONE";

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: parsed.title,
      description: parsed.description,
      assigneeId: parsed.assigneeId,
      clientId: parsed.clientId,
      prospectId: parsed.prospectId,
      quoteId: parsed.quoteId,
      appointmentId: parsed.appointmentId,
      priority: parsed.priority,
      status: parsed.status,
      dueAt: parseDueAt(parsed.dueAt),
      completedAt: isNowDone ? (existing.completedAt ?? new Date()) : wasDone && !isNowDone ? null : existing.completedAt,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: !wasDone && isNowDone ? "task.completed" : "task.updated",
    entityType: "TASK",
    entityId: task.id,
    clientId: parsed.clientId ?? undefined,
    prospectId: parsed.prospectId ?? undefined,
    quoteId: parsed.quoteId ?? undefined,
    appointmentId: parsed.appointmentId ?? undefined,
    oldValue: { title: existing.title, status: existing.status, assigneeId: existing.assigneeId },
    newValue: { title: task.title, status: task.status, assigneeId: task.assigneeId },
  });
  await publishToCrm(tenant.crmId, "task.upserted", { id: task.id });
  if (existing.assigneeId !== parsed.assigneeId) {
    await notifyAssigneeIfNeeded(tenant.crmId, ctx.user.id, parsed.assigneeId, task.id, task.title, "Tâche assignée");
  }
  revalidatePath(`/c/${tenant.crmSlug}/tasks`);

  return { ok: true, taskId: task.id };
}

/** Bascule rapidement le statut d'une tâche (ex : case à cocher "terminée") sans repasser par le formulaire complet. */
export async function setTaskStatus(
  crmId: string,
  taskId: string,
  status: TaskStatus,
  actorCtx?: AuthContext
): Promise<TaskActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId);

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) return { ok: false, error: "Tâche introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Tâche");

  const wasDone = existing.status === "DONE";
  const isNowDone = status === "DONE";

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: isNowDone ? new Date() : null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: !wasDone && isNowDone ? "task.completed" : "task.updated",
    entityType: "TASK",
    entityId: task.id,
    oldValue: { status: existing.status },
    newValue: { status: task.status },
  });
  await publishToCrm(tenant.crmId, "task.upserted", { id: task.id });
  revalidatePath(`/c/${tenant.crmSlug}/tasks`);

  return { ok: true, taskId: task.id };
}

export async function deleteTask(crmId: string, taskId: string, actorCtx?: AuthContext): Promise<TaskActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId);

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) return { ok: false, error: "Tâche introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Tâche");

  const canDelete =
    existing.createdById === ctx.user.id || existing.assigneeId === ctx.user.id || tenant.permissions.has(Permission.DELETE);
  if (!canDelete) return { ok: false, error: "Vous ne pouvez pas supprimer cette tâche." };

  await prisma.task.delete({ where: { id: taskId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "task.deleted",
    entityType: "TASK",
    entityId: taskId,
    oldValue: { title: existing.title },
  });
  await publishToCrm(tenant.crmId, "task.upserted", { id: taskId, deleted: true });
  revalidatePath(`/c/${tenant.crmSlug}/tasks`);

  return { ok: true };
}
