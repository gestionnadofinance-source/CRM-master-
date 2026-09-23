"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { revalidatePath } from "next/cache";
import { AutomationTrigger, TaskPriority } from "@prisma/client";
import { runNoActivitySweep } from "./engine";
import { MAX_LONG, MAX_SHORT, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

// Toute lecture/écriture des règles d'automatisation est réservée aux
// utilisateurs disposant de Permission.MANAGE_SETTINGS sur le CRM concerné :
// il s'agit de configuration d'administration, pas d'usage courant.

const ruleInputSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le nom de la règle est obligatoire."),
  trigger: z.nativeEnum(AutomationTrigger),
  delayDays: z.coerce.number().int().min(0, "Le délai doit être positif.").max(3650),
  actionTitle: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le titre de la tâche est obligatoire."),
  actionDescription: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  actionPriority: z.nativeEnum(TaskPriority),
  actionAssignTo: z.enum(["OWNER", "CREATOR"]),
  actionDueInDays: z.coerce.number().int().min(0).max(3650),
});

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function parseRuleForm(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? "").trim(),
    trigger: String(formData.get("trigger") ?? "") as AutomationTrigger,
    delayDays: String(formData.get("delayDays") ?? "0"),
    actionTitle: String(formData.get("actionTitle") ?? "").trim(),
    actionDescription: emptyToNull(formData.get("actionDescription")),
    actionPriority: String(formData.get("actionPriority") ?? "NORMAL") as TaskPriority,
    actionAssignTo: String(formData.get("actionAssignTo") ?? "OWNER"),
    actionDueInDays: String(formData.get("actionDueInDays") ?? "0"),
  };
  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return parsed.data;
}

export interface AutomationRuleActionResult {
  ok: boolean;
  error?: string;
  ruleId?: string;
}

export async function listAutomationRules(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);
  return prisma.automationRule.findMany({
    where: { crmId: tenant.crmId },
    include: { actions: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createAutomationRule(crmId: string, formData: FormData): Promise<AutomationRuleActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const parsed = parseRuleForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const rule = await prisma.automationRule.create({
    data: {
      crmId: tenant.crmId,
      name: parsed.name,
      trigger: parsed.trigger,
      delayDays: parsed.delayDays,
      isActive: true,
      actions: {
        create: [
          {
            type: "CREATE_TASK",
            config: {
              title: parsed.actionTitle,
              description: parsed.actionDescription ?? undefined,
              priority: parsed.actionPriority,
              assignTo: parsed.actionAssignTo,
              dueInDays: parsed.actionDueInDays,
            },
          },
        ],
      },
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "automation.rule_created",
    entityType: "AUTOMATION_RULE",
    entityId: rule.id,
    newValue: { name: rule.name, trigger: rule.trigger },
  });
  revalidatePath(`/c/${tenant.crmSlug}/settings`);

  return { ok: true, ruleId: rule.id };
}

export async function updateAutomationRule(
  crmId: string,
  ruleId: string,
  formData: FormData
): Promise<AutomationRuleActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const existing = await prisma.automationRule.findUnique({ where: { id: ruleId }, include: { actions: true } });
  if (!existing) return { ok: false, error: "Règle introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Règle d'automatisation");

  const parsed = parseRuleForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const createTaskAction = existing.actions.find((a) => a.type === "CREATE_TASK");

  await prisma.$transaction(async (tx) => {
    await tx.automationRule.update({
      where: { id: ruleId },
      data: { name: parsed.name, trigger: parsed.trigger, delayDays: parsed.delayDays },
    });
    const config = {
      title: parsed.actionTitle,
      description: parsed.actionDescription ?? undefined,
      priority: parsed.actionPriority,
      assignTo: parsed.actionAssignTo,
      dueInDays: parsed.actionDueInDays,
    };
    if (createTaskAction) {
      await tx.automationAction.update({ where: { id: createTaskAction.id }, data: { config } });
    } else {
      await tx.automationAction.create({ data: { ruleId, type: "CREATE_TASK", config } });
    }
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "automation.rule_updated",
    entityType: "AUTOMATION_RULE",
    entityId: ruleId,
    oldValue: { name: existing.name, trigger: existing.trigger, delayDays: existing.delayDays },
    newValue: { name: parsed.name, trigger: parsed.trigger, delayDays: parsed.delayDays },
  });
  revalidatePath(`/c/${tenant.crmSlug}/settings`);

  return { ok: true, ruleId };
}

export async function toggleAutomationRule(
  crmId: string,
  ruleId: string,
  isActive: boolean
): Promise<AutomationRuleActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const existing = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!existing) return { ok: false, error: "Règle introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Règle d'automatisation");

  await prisma.automationRule.update({ where: { id: ruleId }, data: { isActive } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: isActive ? "automation.rule_activated" : "automation.rule_deactivated",
    entityType: "AUTOMATION_RULE",
    entityId: ruleId,
  });
  revalidatePath(`/c/${tenant.crmSlug}/settings`);

  return { ok: true, ruleId };
}

export async function deleteAutomationRule(crmId: string, ruleId: string): Promise<AutomationRuleActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const existing = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!existing) return { ok: false, error: "Règle introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Règle d'automatisation");

  await prisma.automationRule.delete({ where: { id: ruleId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "automation.rule_deleted",
    entityType: "AUTOMATION_RULE",
    entityId: ruleId,
    oldValue: { name: existing.name },
  });
  revalidatePath(`/c/${tenant.crmSlug}/settings`);

  return { ok: true };
}

/**
 * Déclenche manuellement le balayage `NO_ACTIVITY_SINCE` pour ce CRM.
 * Réservé aux administrateurs (Permission.MANAGE_SETTINGS) — utile pour
 * tester une règle sans attendre le prochain passage du cron externe.
 */
export async function runNoActivitySweepNow(crmId: string): Promise<{ ok: boolean; tasksCreated?: number; error?: string }> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const { tasksCreated } = await runNoActivitySweep(tenant.crmId);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "automation.sweep_run",
    entityType: "AUTOMATION_RULE",
    newValue: { tasksCreated },
  });
  revalidatePath(`/c/${tenant.crmSlug}/tasks`);
  revalidatePath(`/c/${tenant.crmSlug}/settings`);

  return { ok: true, tasksCreated };
}
