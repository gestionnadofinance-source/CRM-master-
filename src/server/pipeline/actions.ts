"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { recomputeProspectScore } from "@/server/prospects/actions";
import { listCrmMembers } from "@/server/shared/members";
import { MAX_ID, MAX_SHORT, MAX_TEXT, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS, MAX_DECIMAL_12_2, outOfRange } from "@/lib/validation";

export interface PipelineActionResult {
  ok: boolean;
  error?: string;
  opportunityId?: string;
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Opportunités
// ---------------------------------------------------------------------------

const opportunityInputSchema = z.object({
  title: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le titre est obligatoire."),
  amount: z.number().max(MAX_DECIMAL_12_2, outOfRange(MAX_DECIMAL_12_2)).nullable(),
  ownerId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le commercial est obligatoire."),
  clientId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  prospectId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
  stageId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "L'étape est obligatoire."),
  nextAction: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
});

function parseOpportunityForm(formData: FormData) {
  const amountRaw = emptyToNull(formData.get("amount"));
  const raw = {
    title: String(formData.get("title") ?? "").trim(),
    amount: amountRaw ? Number(amountRaw.replace(",", ".")) : null,
    ownerId: String(formData.get("ownerId") ?? "").trim(),
    clientId: emptyToNull(formData.get("clientId")),
    prospectId: emptyToNull(formData.get("prospectId")),
    stageId: String(formData.get("stageId") ?? "").trim(),
    nextAction: emptyToNull(formData.get("nextAction")),
  };
  return opportunityInputSchema.safeParse(raw);
}

/** Vérifie que le commercial assigné et les entités liées appartiennent bien à ce CRM. */
async function validateOpportunityReferences(
  crmId: string,
  data: { ownerId: string; clientId: string | null; prospectId: string | null }
): Promise<string | null> {
  const members = await listCrmMembers(crmId);
  if (!members.some((m) => m.id === data.ownerId)) {
    return "Le commercial choisi n'appartient pas à ce CRM.";
  }
  if (data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { crmId: true } });
    if (!client || client.crmId !== crmId) return "Client introuvable dans ce CRM.";
  }
  if (data.prospectId) {
    const prospect = await prisma.prospect.findUnique({ where: { id: data.prospectId }, select: { crmId: true } });
    if (!prospect || prospect.crmId !== crmId) return "Prospect introuvable dans ce CRM.";
  }
  return null;
}

export async function createOpportunity(crmId: string, formData: FormData): Promise<PipelineActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_PROSPECTS);

  const parsed = parseOpportunityForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const data = parsed.data;

  const stage = await prisma.pipelineStage.findUnique({ where: { id: data.stageId } });
  if (!stage || stage.crmId !== tenant.crmId) return { ok: false, error: "Étape introuvable." };

  const refError = await validateOpportunityReferences(tenant.crmId, data);
  if (refError) return { ok: false, error: refError };

  const maxPosition = await prisma.opportunity.aggregate({
    where: { crmId: tenant.crmId, stageId: data.stageId },
    _max: { position: true },
  });

  const opportunity = await prisma.opportunity.create({
    data: {
      crmId: tenant.crmId,
      stageId: data.stageId,
      clientId: data.clientId,
      prospectId: data.prospectId,
      title: data.title,
      amount: data.amount,
      ownerId: data.ownerId,
      nextAction: data.nextAction,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });

  await prisma.opportunityHistory.create({
    data: { opportunityId: opportunity.id, fromStageId: null, toStageId: data.stageId, movedById: ctx.user.id },
  });

  if (data.prospectId) await recomputeProspectScore(data.prospectId);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "opportunity.created",
    entityType: "OPPORTUNITY",
    entityId: opportunity.id,
    clientId: data.clientId ?? undefined,
    prospectId: data.prospectId ?? undefined,
    newValue: { title: data.title, stageId: data.stageId },
  });
  await publishToCrm(tenant.crmId, "opportunity.upserted", { id: opportunity.id });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);

  return { ok: true, opportunityId: opportunity.id };
}

export async function updateOpportunity(crmId: string, opportunityId: string, formData: FormData): Promise<PipelineActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);

  const existing = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!existing) return { ok: false, error: "Opportunité introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Opportunité");

  const parsed = parseOpportunityForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const data = parsed.data;

  const refError = await validateOpportunityReferences(tenant.crmId, data);
  if (refError) return { ok: false, error: refError };

  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      title: data.title,
      amount: data.amount,
      ownerId: data.ownerId,
      clientId: data.clientId,
      prospectId: data.prospectId,
      nextAction: data.nextAction,
      lastActivityAt: new Date(),
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "opportunity.updated",
    entityType: "OPPORTUNITY",
    entityId: opportunityId,
    oldValue: { title: existing.title },
    newValue: { title: data.title },
  });
  await publishToCrm(tenant.crmId, "opportunity.upserted", { id: opportunityId });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);

  return { ok: true, opportunityId };
}

export async function deleteOpportunity(crmId: string, opportunityId: string): Promise<PipelineActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const existing = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!existing) return { ok: false, error: "Opportunité introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Opportunité");

  await prisma.opportunity.delete({ where: { id: opportunityId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "opportunity.deleted",
    entityType: "OPPORTUNITY",
    entityId: opportunityId,
    oldValue: { title: existing.title },
  });
  await publishToCrm(tenant.crmId, "opportunity.upserted", { id: opportunityId });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Avancement automatique (déclenché par d'autres modules : agenda, devis...)
// ---------------------------------------------------------------------------

/**
 * Fait avancer l'opportunité liée à un prospect jusqu'à l'étape nommée
 * `targetStageName` (ex : "Rendez-vous" quand un RDV est programmé, "Devis"
 * quand un devis est émis) — sans jamais faire reculer une opportunité déjà
 * plus avancée dans le pipeline, ni une opportunité gagnée/perdue. Si aucune
 * opportunité n'existe encore pour ce prospect, en crée une directement dans
 * l'étape cible plutôt que d'échouer silencieusement.
 */
export async function advanceProspectOpportunityStage(
  crmId: string,
  prospectId: string,
  targetStageName: string,
  movedById: string
): Promise<void> {
  const targetStage = await prisma.pipelineStage.findFirst({ where: { crmId, name: targetStageName } });
  if (!targetStage) return;

  const opportunity = await prisma.opportunity.findFirst({
    where: { crmId, prospectId },
    orderBy: { createdAt: "asc" },
    include: { stage: true },
  });

  if (!opportunity) {
    const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, select: { company: true, ownerId: true } });
    if (!prospect) return;
    const maxPosition = await prisma.opportunity.aggregate({
      where: { crmId, stageId: targetStage.id },
      _max: { position: true },
    });
    const created = await prisma.opportunity.create({
      data: {
        crmId,
        stageId: targetStage.id,
        prospectId,
        title: prospect.company,
        ownerId: prospect.ownerId,
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });
    await prisma.opportunityHistory.create({
      data: { opportunityId: created.id, fromStageId: null, toStageId: targetStage.id, movedById },
    });
    await publishToCrm(crmId, "opportunity.upserted", { id: created.id });
    return;
  }

  if (opportunity.stage.isWon || opportunity.stage.isLost) return;
  if (opportunity.stage.order >= targetStage.order) return;

  const fromStageId = opportunity.stageId;
  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({
      where: { crmId, stageId: fromStageId, position: { gt: opportunity.position } },
      data: { position: { decrement: 1 } },
    });
    const maxPosition = await tx.opportunity.aggregate({
      where: { crmId, stageId: targetStage.id },
      _max: { position: true },
    });
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: { stageId: targetStage.id, position: (maxPosition._max.position ?? -1) + 1, lastActivityAt: new Date() },
    });
    await tx.opportunityHistory.create({
      data: { opportunityId: opportunity.id, fromStageId, toStageId: targetStage.id, movedById },
    });
  });
  await publishToCrm(crmId, "opportunity.moved", { id: opportunity.id, fromStageId, toStageId: targetStage.id });
}

// ---------------------------------------------------------------------------
// Déplacement (drag & drop)
// ---------------------------------------------------------------------------

export interface MoveOpportunityInput {
  opportunityId: string;
  toStageId: string;
  toPosition: number;
  lostReason?: string;
}

export async function moveOpportunity(crmId: string, input: MoveOpportunityInput): Promise<PipelineActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_PROSPECTS);

  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) return { ok: false, error: "Opportunité introuvable." };
  assertBelongsToCrm(opportunity.crmId, tenant, "Opportunité");

  const toStage = await prisma.pipelineStage.findUnique({ where: { id: input.toStageId } });
  if (!toStage || toStage.crmId !== tenant.crmId) return { ok: false, error: "Étape introuvable." };

  if (toStage.isLost && !input.lostReason?.trim()) {
    return { ok: false, error: "Un motif de perte est requis pour cette étape." };
  }

  const fromStageId = opportunity.stageId;

  await prisma.$transaction(async (tx) => {
    // Referme les positions dans la colonne d'origine.
    await tx.opportunity.updateMany({
      where: { crmId: tenant.crmId, stageId: fromStageId, position: { gt: opportunity.position } },
      data: { position: { decrement: 1 } },
    });
    // Ouvre une place dans la colonne de destination.
    await tx.opportunity.updateMany({
      where: { crmId: tenant.crmId, stageId: input.toStageId, position: { gte: input.toPosition } },
      data: { position: { increment: 1 } },
    });

    await tx.opportunity.update({
      where: { id: input.opportunityId },
      data: {
        stageId: input.toStageId,
        position: input.toPosition,
        lastActivityAt: new Date(),
        ...(toStage.isWon ? { wonAt: new Date() } : {}),
        ...(toStage.isLost ? { lostAt: new Date(), lostReason: input.lostReason?.trim() } : {}),
      },
    });

    await tx.opportunityHistory.create({
      data: {
        opportunityId: input.opportunityId,
        fromStageId,
        toStageId: input.toStageId,
        movedById: ctx.user.id,
      },
    });
  });

  if (opportunity.prospectId) await recomputeProspectScore(opportunity.prospectId);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "opportunity.stage_changed",
    entityType: "OPPORTUNITY",
    entityId: input.opportunityId,
    oldValue: { stageId: fromStageId },
    newValue: { stageId: input.toStageId },
  });
  await publishToCrm(tenant.crmId, "opportunity.moved", {
    id: input.opportunityId,
    fromStageId,
    toStageId: input.toStageId,
  });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);

  return { ok: true, opportunityId: input.opportunityId };
}

// ---------------------------------------------------------------------------
// Étapes du pipeline (configuration)
// ---------------------------------------------------------------------------

export interface StageActionResult {
  ok: boolean;
  error?: string;
  stageId?: string;
}

export async function createStage(crmId: string, formData: FormData): Promise<StageActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#94a3b8").trim();
  const isWon = formData.get("isWon") === "on";
  const isLost = formData.get("isLost") === "on";
  if (!name) return { ok: false, error: "Le nom de l'étape est obligatoire." };

  const maxOrder = await prisma.pipelineStage.aggregate({ where: { crmId: tenant.crmId }, _max: { order: true } });
  const stage = await prisma.pipelineStage.create({
    data: { crmId: tenant.crmId, name, color, isWon, isLost, order: (maxOrder._max.order ?? -1) + 1 },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pipeline_stage.created",
    entityType: "PIPELINE_STAGE",
    entityId: stage.id,
    newValue: { name },
  });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  return { ok: true, stageId: stage.id };
}

export async function updateStage(crmId: string, stageId: string, formData: FormData): Promise<StageActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!stage) return { ok: false, error: "Étape introuvable." };
  assertBelongsToCrm(stage.crmId, tenant, "Étape");

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? stage.color).trim();
  const isWon = formData.get("isWon") === "on";
  const isLost = formData.get("isLost") === "on";
  if (!name) return { ok: false, error: "Le nom de l'étape est obligatoire." };

  await prisma.pipelineStage.update({ where: { id: stageId }, data: { name, color, isWon, isLost } });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  return { ok: true, stageId };
}

export async function reorderStages(crmId: string, orderedStageIds: string[]): Promise<StageActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const stages = await prisma.pipelineStage.findMany({ where: { crmId: tenant.crmId } });
  const validIds = new Set(stages.map((s) => s.id));
  if (orderedStageIds.some((id) => !validIds.has(id))) {
    return { ok: false, error: "Étape inconnue dans ce CRM." };
  }

  await prisma.$transaction(
    orderedStageIds.map((id, index) => prisma.pipelineStage.update({ where: { id }, data: { order: index } }))
  );
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  return { ok: true };
}

export async function deleteStage(crmId: string, stageId: string, reassignToStageId?: string): Promise<StageActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);

  const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!stage) return { ok: false, error: "Étape introuvable." };
  assertBelongsToCrm(stage.crmId, tenant, "Étape");

  const opportunityCount = await prisma.opportunity.count({ where: { stageId } });
  if (opportunityCount > 0) {
    if (!reassignToStageId) {
      return { ok: false, error: `Cette étape contient ${opportunityCount} opportunité(s). Choisissez une étape de repli avant de la supprimer.` };
    }
    const target = await prisma.pipelineStage.findUnique({ where: { id: reassignToStageId } });
    if (!target || target.crmId !== tenant.crmId || target.id === stageId) {
      return { ok: false, error: "Étape de repli invalide." };
    }
    await prisma.opportunity.updateMany({ where: { stageId }, data: { stageId: reassignToStageId } });
  }

  await prisma.pipelineStage.delete({ where: { id: stageId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "pipeline_stage.deleted",
    entityType: "PIPELINE_STAGE",
    entityId: stageId,
    oldValue: { name: stage.name },
  });
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  return { ok: true };
}
