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
import { ClientStatus } from "@prisma/client";
import { removeStorageKeys } from "@/lib/storage";
import { MAX_CODE, MAX_ID, MAX_LONG, MAX_SHORT, MAX_TEXT, tooLong } from "@/lib/validation";

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

const clientInputSchema = z.object({
  company: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "L'entreprise est obligatoire."),
  sector: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).email("Adresse email invalide.").nullable().or(z.literal(null)),
  address: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).nullable(),
  activity: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).nullable(),
  size: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).nullable(),
  siret: z
    .string()
    .trim()
    .regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres.")
    .nullable(),
  status: z.nativeEnum(ClientStatus),
  sourceId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).nullable(),
  ownerId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).min(1, "Le commercial est obligatoire."),
  notes: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).nullable(),
  tagIds: z.array(z.string().max(MAX_ID, tooLong(MAX_ID))),
});

export type ClientInput = z.infer<typeof clientInputSchema>;

function parseClientForm(formData: FormData): ClientInput | { error: string } {
  const raw = {
    company: String(formData.get("company") ?? "").trim(),
    sector: emptyToNull(formData.get("sector")),
    firstName: emptyToNull(formData.get("firstName")),
    lastName: emptyToNull(formData.get("lastName")),
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
    address: emptyToNull(formData.get("address")),
    activity: emptyToNull(formData.get("activity")),
    size: emptyToNull(formData.get("size")),
    siret: emptyToNull(formData.get("siret")),
    status: (String(formData.get("status") ?? "ACTIVE") as ClientStatus),
    sourceId: emptyToNull(formData.get("sourceId")),
    ownerId: String(formData.get("ownerId") ?? "").trim(),
    notes: emptyToNull(formData.get("notes")),
    tagIds: formData.getAll("tagIds").map(String),
  };
  const parsed = clientInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  return parsed.data;
}

export interface ClientActionResult {
  ok: boolean;
  error?: string;
  clientId?: string;
  duplicate?: { id: string; company: string };
}

export async function createClient(crmId: string, formData: FormData, actorCtx?: AuthContext): Promise<ClientActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_CLIENTS);

  const parsed = parseClientForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const confirmDuplicate = formData.get("confirmDuplicate") === "true";

  const data = {
    crmId: tenant.crmId,
    company: parsed.company,
    sector: parsed.sector,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    activity: parsed.activity,
    size: parsed.size,
    siret: parsed.siret,
    status: parsed.status,
    sourceId: parsed.sourceId,
    ownerId: parsed.ownerId,
    notes: parsed.notes,
    tags: { create: parsed.tagIds.map((tagId) => ({ tagId })) },
  };

  // Le contrôle de doublon et la création tiennent dans une seule
  // transaction sérialisable : en READ COMMITTED, deux créations
  // simultanées portant le même SIRET ne voient ni l'une ni l'autre de
  // doublon et insèrent toutes les deux. Sans SIRET, ou quand
  // l'utilisateur a confirmé vouloir le doublon, il n'y a rien à lire :
  // création directe, sans le coût de la sérialisation.
  const outcome =
    parsed.siret && !confirmDuplicate
      ? await runSerializable(async (tx) => {
          const existing = await tx.client.findFirst({
            where: { crmId: tenant.crmId, siret: parsed.siret },
            select: { id: true, company: true },
          });
          if (existing) return { duplicate: existing };
          return { client: await tx.client.create({ data }) };
        })
      : { client: await prisma.client.create({ data }) };

  if ("duplicate" in outcome) return { ok: false, duplicate: outcome.duplicate };
  const client = outcome.client;

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "client.created",
    entityType: "CLIENT",
    entityId: client.id,
    clientId: client.id,
    newValue: { company: client.company },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "CLIENT_UPDATED",
    title: `Nouveau client : ${client.company}`,
    entityType: "CLIENT",
    entityId: client.id,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "client.upserted", { id: client.id });
  revalidatePath(`/c/${tenant.crmSlug}/clients`);

  return { ok: true, clientId: client.id };
}

export async function updateClient(
  crmId: string,
  clientId: string,
  formData: FormData,
  actorCtx?: AuthContext
): Promise<ClientActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Client");

  const parsed = parseClientForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const confirmDuplicate = formData.get("confirmDuplicate") === "true";
  const checkSiret = Boolean(parsed.siret) && parsed.siret !== existing.siret && !confirmDuplicate;

  const applyUpdate = async (tx: TransactionClient) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        company: parsed.company,
        sector: parsed.sector,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        activity: parsed.activity,
        size: parsed.size,
        siret: parsed.siret,
        status: parsed.status,
        sourceId: parsed.sourceId,
        ownerId: parsed.ownerId,
        notes: parsed.notes,
      },
    });
    await tx.clientTag.deleteMany({ where: { clientId } });
    await tx.clientTag.createMany({ data: parsed.tagIds.map((tagId) => ({ clientId, tagId })) });
  };

  // Même course qu'à la création quand le SIRET change : le contrôle de
  // doublon et la mise à jour doivent tenir dans une seule transaction
  // sérialisable. Sans changement de SIRET, la mise à jour ne dépend
  // d'aucune lecture concurrente et garde l'isolation par défaut.
  if (checkSiret) {
    const dup = await runSerializable(async (tx) => {
      const found = await tx.client.findFirst({
        where: { crmId: tenant.crmId, siret: parsed.siret, id: { not: clientId } },
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

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "client.updated",
    entityType: "CLIENT",
    entityId: clientId,
    clientId,
    oldValue: { company: existing.company, status: existing.status },
    newValue: { company: parsed.company, status: parsed.status },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "CLIENT_UPDATED",
    title: `Client mis à jour : ${parsed.company}`,
    entityType: "CLIENT",
    entityId: clientId,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "client.upserted", { id: clientId });
  revalidatePath(`/c/${tenant.crmSlug}/clients`);
  revalidatePath(`/c/${tenant.crmSlug}/clients/${clientId}`);

  return { ok: true, clientId };
}

export async function deleteClient(crmId: string, clientId: string, actorCtx?: AuthContext): Promise<ClientActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Client");

  // Document.clientId est en onDelete: Cascade — les lignes seront
  // supprimées automatiquement, mais Prisma ne touche jamais aux fichiers
  // physiques : il faut les effacer explicitement avant, sans quoi ils
  // restent orphelins indéfiniment dans le stockage configuré.
  const clientDocs = await prisma.document.findMany({ where: { clientId }, select: { storageKey: true } });
  await removeStorageKeys(clientDocs.map((d) => d.storageKey));

  await prisma.client.delete({ where: { id: clientId } });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "client.deleted",
    entityType: "CLIENT",
    entityId: clientId,
    oldValue: { company: existing.company },
  });
  await publishToCrm(tenant.crmId, "client.deleted", { id: clientId });
  revalidatePath(`/c/${tenant.crmSlug}/clients`);

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

export async function addClientContact(crmId: string, clientId: string, formData: FormData): Promise<ClientActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(client.crmId, tenant, "Client");

  const parsed = contactSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    role: emptyToNull(formData.get("role")),
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.clientContact.create({ data: { clientId, ...parsed.data } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "client.contact_added",
    entityType: "CLIENT",
    entityId: clientId,
    clientId,
    newValue: parsed.data,
  });
  revalidatePath(`/c/${tenant.crmSlug}/clients/${clientId}`);
  return { ok: true, clientId };
}

export async function deleteClientContact(crmId: string, clientId: string, contactId: string): Promise<ClientActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(client.crmId, tenant, "Client");

  await prisma.clientContact.deleteMany({ where: { id: contactId, clientId } });
  revalidatePath(`/c/${tenant.crmSlug}/clients/${clientId}`);
  return { ok: true, clientId };
}

// ---------------------------------------------------------------------------
// Collaborateurs secondaires
// ---------------------------------------------------------------------------

export async function addClientCollaborator(crmId: string, clientId: string, userId: string): Promise<ClientActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(client.crmId, tenant, "Client");

  await prisma.clientCollaborator.upsert({
    where: { clientId_userId: { clientId, userId } },
    update: {},
    create: { clientId, userId },
  });
  revalidatePath(`/c/${tenant.crmSlug}/clients/${clientId}`);
  return { ok: true, clientId };
}

export async function removeClientCollaborator(crmId: string, clientId: string, userId: string): Promise<ClientActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.EDIT);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, error: "Client introuvable." };
  assertBelongsToCrm(client.crmId, tenant, "Client");

  await prisma.clientCollaborator.deleteMany({ where: { clientId, userId } });
  revalidatePath(`/c/${tenant.crmSlug}/clients/${clientId}`);
  return { ok: true, clientId };
}
