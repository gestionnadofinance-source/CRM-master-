"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { runSerializable, type TransactionClient } from "@/server/transactions";
import { notifyCrm } from "@/server/notifications/create";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ProspectStatus } from "@prisma/client";
import { computeProspectScore } from "@/server/prospects/scoring";
import { listCrmMembers } from "@/server/shared/members";
import { removeStorageKeys } from "@/lib/storage";
import { MAX_CODE, MAX_ID, MAX_LONG, MAX_SHORT, MAX_TEXT, tooLong } from "@/lib/validation";

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function parseAmount(v: FormDataEntryValue | null): number | null {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Recalcule et persiste le score d'un prospect à partir des critères
 * observables (rendez-vous pris, opportunité/devis en cours, source,
 * récence du dernier contact, montant potentiel). Appelée depuis les
 * actions create/update de ce module ; peut aussi être invoquée par
 * d'autres modules (ex : pipeline) après un événement qui change le score.
 */
export async function recomputeProspectScore(prospectId: string) {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, include: { source: true } });
  if (!prospect) return null;

  const [appointmentCount, opportunityCount] = await Promise.all([
    prisma.appointment.count({ where: { prospectId } }),
    prisma.opportunity.count({ where: { prospectId } }),
  ]);

  const result = computeProspectScore({
    sourceName: prospect.source?.name ?? null,
    hasAppointment: appointmentCount > 0,
    hasQuoteOrOpportunity: opportunityCount > 0,
    lastContactAt: prospect.lastContactAt,
    potentialAmount: prospect.potentialAmount ? Number(prospect.potentialAmount) : null,
  });

  await prisma.prospect.update({
    where: { id: prospectId },
    data: { score: result.score, scoreBreakdown: result.breakdown as unknown as object },
  });

  return result;
}

const prospectInputSchema = z.object({
  company: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "L'entreprise est obligatoire."),
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).email("Adresse email invalide.").nullable().or(z.literal(null)),
  address: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).nullable(),
  siret: z
    .string()
    .trim()
    .regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres.")
    .nullable(),
  sector: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  activity: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  size: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  sourceId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).nullable(),
  ownerId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).min(1, "Le commercial est obligatoire."),
  status: z.nativeEnum(ProspectStatus),
  potentialAmount: z.number().nullable(),
  notes: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  tagIds: z.array(z.string().max(MAX_ID, tooLong(MAX_ID))),
});

export type ProspectInput = z.infer<typeof prospectInputSchema>;

function parseProspectForm(formData: FormData): ProspectInput | { error: string } {
  const raw = {
    company: String(formData.get("company") ?? "").trim(),
    firstName: emptyToNull(formData.get("firstName")),
    lastName: emptyToNull(formData.get("lastName")),
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
    address: emptyToNull(formData.get("address")),
    siret: emptyToNull(formData.get("siret")),
    sector: emptyToNull(formData.get("sector")),
    activity: emptyToNull(formData.get("activity")),
    size: emptyToNull(formData.get("size")),
    sourceId: emptyToNull(formData.get("sourceId")),
    ownerId: String(formData.get("ownerId") ?? "").trim(),
    status: (String(formData.get("status") ?? "TO_FOLLOW_UP") as ProspectStatus),
    potentialAmount: parseAmount(formData.get("potentialAmount")),
    notes: emptyToNull(formData.get("notes")),
    tagIds: formData.getAll("tagIds").map(String),
  };
  const parsed = prospectInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return parsed.data;
}

/** Vérifie que le commercial, la source et les tags choisis appartiennent bien à ce CRM. */
async function validateProspectReferences(
  crmId: string,
  data: { ownerId: string; sourceId: string | null; tagIds: string[] }
): Promise<string | null> {
  const members = await listCrmMembers(crmId);
  if (!members.some((m) => m.id === data.ownerId)) {
    return "Le commercial choisi n'appartient pas à ce CRM.";
  }
  if (data.sourceId) {
    const source = await prisma.source.findUnique({ where: { id: data.sourceId }, select: { crmId: true } });
    if (!source || source.crmId !== crmId) return "Source introuvable dans ce CRM.";
  }
  if (data.tagIds.length > 0) {
    const tags = await prisma.tag.findMany({ where: { id: { in: data.tagIds } }, select: { id: true, crmId: true } });
    if (tags.length !== data.tagIds.length || tags.some((t) => t.crmId !== crmId)) {
      return "Étiquette introuvable dans ce CRM.";
    }
  }
  return null;
}

export interface ProspectActionResult {
  ok: boolean;
  error?: string;
  prospectId?: string;
  duplicate?: { id: string; company: string };
}

export async function createProspect(
  crmId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<ProspectActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_PROSPECTS);

  const parsed = parseProspectForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const refError = await validateProspectReferences(tenant.crmId, parsed);
  if (refError) return { ok: false, error: refError };

  const confirmDuplicate = formData.get("confirmDuplicate") === "true";

  const data = {
    crmId: tenant.crmId,
    company: parsed.company,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    siret: parsed.siret,
    sector: parsed.sector,
    activity: parsed.activity,
    size: parsed.size,
    sourceId: parsed.sourceId,
    ownerId: parsed.ownerId,
    status: parsed.status,
    potentialAmount: parsed.potentialAmount,
    notes: parsed.notes,
    tags: { create: parsed.tagIds.map((tagId) => ({ tagId })) },
  };

  // Contrôle de doublon et création dans la même transaction sérialisable
  // (même course que côté clients, cf. src/server/transactions.ts). Sans
  // SIRET, ou sur doublon confirmé, aucune lecture n'est en jeu.
  const outcome =
    parsed.siret && !confirmDuplicate
      ? await runSerializable(async (tx) => {
          const existing = await tx.prospect.findFirst({
            where: { crmId: tenant.crmId, siret: parsed.siret },
            select: { id: true, company: true },
          });
          if (existing) return { duplicate: existing };
          return { prospect: await tx.prospect.create({ data }) };
        })
      : { prospect: await prisma.prospect.create({ data }) };

  if ("duplicate" in outcome) return { ok: false, duplicate: outcome.duplicate };
  const prospect = outcome.prospect;

  await recomputeProspectScore(prospect.id);

  // Tout nouveau prospect apparaît automatiquement dans la première étape du
  // pipeline (par défaut "Nouveau prospect", cf. provision-crm.ts / seed.ts).
  const firstStage = await prisma.pipelineStage.findFirst({
    where: { crmId: tenant.crmId },
    orderBy: { order: "asc" },
  });
  let newOpportunityId: string | null = null;
  if (firstStage) {
    const maxPosition = await prisma.opportunity.aggregate({
      where: { crmId: tenant.crmId, stageId: firstStage.id },
      _max: { position: true },
    });
    const opportunity = await prisma.opportunity.create({
      data: {
        crmId: tenant.crmId,
        stageId: firstStage.id,
        prospectId: prospect.id,
        title: prospect.company,
        ownerId: prospect.ownerId,
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });
    await prisma.opportunityHistory.create({
      data: { opportunityId: opportunity.id, fromStageId: null, toStageId: firstStage.id, movedById: ctx.user.id },
    });
    newOpportunityId = opportunity.id;
  }

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "prospect.created",
    entityType: "PROSPECT",
    entityId: prospect.id,
    prospectId: prospect.id,
    newValue: { company: prospect.company },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "PROSPECT_CREATED",
    title: `Nouveau prospect : ${prospect.company}`,
    entityType: "PROSPECT",
    entityId: prospect.id,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "prospect.upserted", { id: prospect.id });
  if (newOpportunityId) await publishToCrm(tenant.crmId, "opportunity.upserted", { id: newOpportunityId });
  revalidatePath(`/c/${tenant.crmSlug}/prospects`);
  revalidatePath(`/c/${tenant.crmSlug}/pipeline`);

  return { ok: true, prospectId: prospect.id };
}

export async function updateProspect(
  crmId: string,
  prospectId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<ProspectActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);

  const existing = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!existing) return { ok: false, error: "Prospect introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Prospect");

  const parsed = parseProspectForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const refError = await validateProspectReferences(tenant.crmId, parsed);
  if (refError) return { ok: false, error: refError };

  const confirmDuplicate = formData.get("confirmDuplicate") === "true";
  const checkSiret = Boolean(parsed.siret) && parsed.siret !== existing.siret && !confirmDuplicate;

  const lastContactAtRaw = emptyToNull(formData.get("lastContactAt"));
  const nextContactAtRaw = emptyToNull(formData.get("nextContactAt"));

  const applyUpdate = async (tx: TransactionClient) => {
    await tx.prospect.update({
      where: { id: prospectId },
      data: {
        company: parsed.company,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        siret: parsed.siret,
        sector: parsed.sector,
        activity: parsed.activity,
        size: parsed.size,
        sourceId: parsed.sourceId,
        ownerId: parsed.ownerId,
        status: parsed.status,
        potentialAmount: parsed.potentialAmount,
        notes: parsed.notes,
        ...(lastContactAtRaw ? { lastContactAt: new Date(lastContactAtRaw) } : {}),
        ...(nextContactAtRaw ? { nextContactAt: new Date(nextContactAtRaw) } : {}),
      },
    });
    await tx.prospectTag.deleteMany({ where: { prospectId } });
    await tx.prospectTag.createMany({ data: parsed.tagIds.map((tagId) => ({ prospectId, tagId })) });
  };

  if (checkSiret) {
    const dup = await runSerializable(async (tx) => {
      const found = await tx.prospect.findFirst({
        where: { crmId: tenant.crmId, siret: parsed.siret, id: { not: prospectId } },
        select: { id: true, company: true },
      });
      if (found) return found;
      await applyUpdate(tx);
      return null;
    });
    if (dup) return { ok: false, duplicate: dup };
  } else {
    await prisma.$transaction(applyUpdate);
  }

  await recomputeProspectScore(prospectId);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "prospect.updated",
    entityType: "PROSPECT",
    entityId: prospectId,
    prospectId,
    oldValue: { company: existing.company, status: existing.status },
    newValue: { company: parsed.company, status: parsed.status },
  });
  await publishToCrm(tenant.crmId, "prospect.upserted", { id: prospectId });
  revalidatePath(`/c/${tenant.crmSlug}/prospects`);
  revalidatePath(`/c/${tenant.crmSlug}/prospects/${prospectId}`);

  return { ok: true, prospectId };
}

export async function deleteProspect(
  crmId: string,
  prospectId: string,
  actorCtx?: AuthContext
): Promise<ProspectActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const existing = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!existing) return { ok: false, error: "Prospect introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Prospect");

  // Document.prospectId est en onDelete: Cascade — les lignes seront
  // supprimées automatiquement, mais pas les fichiers physiques : à
  // effacer explicitement avant, sans quoi ils restent orphelins.
  const prospectDocs = await prisma.document.findMany({ where: { prospectId }, select: { storageKey: true } });
  await removeStorageKeys(prospectDocs.map((d) => d.storageKey));

  await prisma.prospect.delete({ where: { id: prospectId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "prospect.deleted",
    entityType: "PROSPECT",
    entityId: prospectId,
    oldValue: { company: existing.company },
  });
  await publishToCrm(tenant.crmId, "prospect.deleted", { id: prospectId });
  revalidatePath(`/c/${tenant.crmSlug}/prospects`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contacts additionnels
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le prénom est obligatoire."),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  role: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).email("Adresse email invalide.").nullable().or(z.literal(null)),
});

export async function addProspectContact(crmId: string, prospectId: string, formData: FormData): Promise<ProspectActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return { ok: false, error: "Prospect introuvable." };
  assertBelongsToCrm(prospect.crmId, tenant, "Prospect");

  const parsed = contactSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    role: emptyToNull(formData.get("role")),
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.prospectContact.create({ data: { prospectId, ...parsed.data } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "prospect.contact_added",
    entityType: "PROSPECT",
    entityId: prospectId,
    prospectId,
    newValue: parsed.data,
  });
  revalidatePath(`/c/${tenant.crmSlug}/prospects/${prospectId}`);
  return { ok: true, prospectId };
}

export async function deleteProspectContact(crmId: string, prospectId: string, contactId: string): Promise<ProspectActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return { ok: false, error: "Prospect introuvable." };
  assertBelongsToCrm(prospect.crmId, tenant, "Prospect");

  await prisma.prospectContact.deleteMany({ where: { id: contactId, prospectId } });
  revalidatePath(`/c/${tenant.crmSlug}/prospects/${prospectId}`);
  return { ok: true, prospectId };
}

// ---------------------------------------------------------------------------
// Conversion prospect -> client
// ---------------------------------------------------------------------------

export interface ConvertResult {
  ok: boolean;
  error?: string;
  clientId?: string;
}

export async function convertProspectToClient(crmId: string, prospectId: string): Promise<ConvertResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_PROSPECTS);
  if (!tenant.permissions.has(Permission.MANAGE_CLIENTS)) {
    return { ok: false, error: "Vous n'avez pas la permission de créer des clients." };
  }

  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { contacts: true, convertedTo: true },
  });
  if (!prospect) return { ok: false, error: "Prospect introuvable." };
  assertBelongsToCrm(prospect.crmId, tenant, "Prospect");

  if (prospect.convertedTo) {
    return { ok: true, clientId: prospect.convertedTo.id };
  }

  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        crmId: tenant.crmId,
        company: prospect.company,
        sector: prospect.sector,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        phone: prospect.phone,
        email: prospect.email,
        address: prospect.address,
        activity: prospect.activity,
        size: prospect.size,
        siret: prospect.siret,
        sourceId: prospect.sourceId,
        ownerId: prospect.ownerId,
        notes: prospect.notes,
        status: "ACTIVE",
        convertedFromId: prospect.id,
      },
    });

    if (prospect.contacts.length > 0) {
      await tx.clientContact.createMany({
        data: prospect.contacts.map((c) => ({
          clientId: created.id,
          firstName: c.firstName,
          lastName: c.lastName,
          role: c.role,
          phone: c.phone,
          email: c.email,
        })),
      });
    }

    await tx.prospect.update({ where: { id: prospect.id }, data: { status: "CONVERTED" } });
    await tx.task.updateMany({ where: { prospectId: prospect.id }, data: { clientId: created.id } });
    await tx.appointment.updateMany({ where: { prospectId: prospect.id }, data: { clientId: created.id } });

    return created;
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "prospect.converted",
    entityType: "PROSPECT",
    entityId: prospect.id,
    prospectId: prospect.id,
    clientId: client.id,
    newValue: { clientId: client.id },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "CLIENT_UPDATED",
    title: `Prospect converti en client : ${client.company}`,
    entityType: "CLIENT",
    entityId: client.id,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "client.upserted", { id: client.id });
  await publishToCrm(tenant.crmId, "prospect.upserted", { id: prospect.id });
  revalidatePath(`/c/${tenant.crmSlug}/prospects`);
  revalidatePath(`/c/${tenant.crmSlug}/clients`);

  return { ok: true, clientId: client.id };
}

export async function convertProspectAndRedirect(crmId: string, prospectId: string, crmSlug: string): Promise<void> {
  const res = await convertProspectToClient(crmId, prospectId);
  if (res.ok && res.clientId) {
    redirect(`/c/${crmSlug}/clients/${res.clientId}`);
  }
}
