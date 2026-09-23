"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, type AuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { notifyCrm } from "@/server/notifications/create";
import { publishToCrm } from "@/lib/realtime";
import { getStorageDriver, removeStorageKeys } from "@/lib/storage";
import { generateQuoteNumber } from "@/server/quotes/numbering";
import { computeTotals } from "@/server/quotes/totals";
import { renderQuotePdfBuffer } from "@/server/quotes/pdf";
import { QUOTE_STATUS_TRANSITIONS } from "@/server/quotes/status";
import { revalidatePath } from "next/cache";
import { QuoteStatus } from "@prisma/client";
import { advanceProspectOpportunityStage } from "@/server/pipeline/actions";
import { MAX_DECIMAL_10_2, MAX_DECIMAL_12_2, MAX_ID, MAX_LONG, MAX_SHORT, MAX_TEXT, outOfRange, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const quoteItemInputSchema = z.object({
  id: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(), // présent = ligne existante (informatif seulement, on réécrit toujours)
  designation: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "La désignation est obligatoire."),
  quantity: z.coerce.number().positive("La quantité doit être strictement positive.").max(MAX_DECIMAL_10_2, outOfRange(MAX_DECIMAL_10_2)),
  unitPriceHt: z.coerce.number().min(0, "Le prix unitaire doit être positif ou nul.").max(MAX_DECIMAL_12_2, outOfRange(MAX_DECIMAL_12_2)),
  vatRateId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le taux de TVA est obligatoire."),
});

const quoteSaveSchema = z
  .object({
    clientId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
    prospectId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable(),
    object: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "L'objet est obligatoire."),
    issueDate: z.coerce.date({ errorMap: () => ({ message: "Date d'émission invalide." }) }),
    validUntil: z.coerce.date({ errorMap: () => ({ message: "Date de validité invalide." }) }),
    conditions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable().optional(),
    mentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).nullable().optional(),
    items: z.array(quoteItemInputSchema).min(1, "Ajoutez au moins une ligne de devis."),
  })
  .refine((data) => data.validUntil >= data.issueDate, {
    message: "La date de validité doit être postérieure à la date d'émission.",
    path: ["validUntil"],
  })
  .refine((data) => !!data.clientId || !!data.prospectId, {
    message: "Sélectionnez un client ou un prospect.",
    path: ["clientId"],
  })
  .refine((data) => !(data.clientId && data.prospectId), {
    message: "Choisissez un client OU un prospect, pas les deux.",
    path: ["clientId"],
  });

export type QuoteSaveInput = z.infer<typeof quoteSaveSchema>;

export interface QuoteActionResult {
  ok: boolean;
  error?: string;
  quoteId?: string;
}

const SENT_LIKE_STATUSES: QuoteStatus[] = ["SENT", "FOLLOWED_UP", "ACCEPTED", "REFUSED", "EXPIRED"];

// Texte générique utilisé pour pré-remplir les conditions et mentions
// légales d'un nouveau devis quand le CRM n'a pas défini de modèle par
// défaut (ou que celui-ci ne renseigne pas ces champs) — l'utilisateur peut
// toujours les modifier librement avant d'enregistrer.
const GENERIC_DEFAULT_CONDITIONS =
  "Devis valable 30 jours à compter de la date d'émission. Acompte de 30 % à la commande, solde à la livraison. " +
  "Sauf mention contraire, tout paiement est dû à réception de facture. Tout retard de paiement entraîne l'application " +
  "de pénalités au taux d'intérêt légal en vigueur, ainsi qu'une indemnité forfaitaire de recouvrement de 40 € " +
  "(article L441-10 du Code de commerce).";
const GENERIC_DEFAULT_MENTIONS =
  "Le présent devis constitue une offre commerciale valable pendant la durée indiquée ci-dessus. Toute acceptation " +
  "du client (bon pour accord signé) vaut engagement ferme des deux parties. En cas de litige, seul le tribunal " +
  "compétent du siège social de l'entreprise sera saisi.";

// ---------------------------------------------------------------------------
// Lecture (données de l'éditeur)
// ---------------------------------------------------------------------------

export async function getQuoteEditorData(crmId: string, quoteId: string | null) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);

  const [clients, prospects, vatRates, defaultTemplate] = await Promise.all([
    prisma.client.findMany({
      where: { crmId: tenant.crmId },
      orderBy: { company: "asc" },
      select: { id: true, company: true, siret: true, address: true, email: true },
    }),
    // Un prospect converti a désormais sa propre fiche client : il ne doit
    // plus apparaître dans la liste des prospects, seulement dans celle des
    // clients, pour éviter qu'il figure des deux côtés à la fois.
    prisma.prospect.findMany({
      where: { crmId: tenant.crmId, status: { not: "CONVERTED" } },
      orderBy: { company: "asc" },
      select: { id: true, company: true, siret: true, address: true, email: true },
    }),
    prisma.vatRate.findMany({ where: { crmId: tenant.crmId }, orderBy: { rate: "desc" } }),
    prisma.quoteTemplate.findFirst({ where: { crmId: tenant.crmId, isDefault: true } }),
  ]);

  // Le modèle par défaut du CRM (Réglages > Modèles de devis) prime s'il
  // renseigne conditions/mentions ; sinon on retombe sur un texte générique.
  const defaultConditions = defaultTemplate?.conditions?.trim() || GENERIC_DEFAULT_CONDITIONS;
  const defaultMentions = defaultTemplate?.mentions?.trim() || GENERIC_DEFAULT_MENTIONS;

  let quote = null;
  if (quoteId) {
    const found = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        items: { orderBy: { order: "asc" } },
        client: { select: { id: true, company: true } },
        prospect: { select: { id: true, company: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        versions: { orderBy: { versionNumber: "desc" }, include: { author: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!found) return { ok: false as const, error: "Devis introuvable." };
    assertBelongsToCrm(found.crmId, tenant, "Devis");
    quote = found;
  }

  // "Activité récente" du devis ne montre que les 24 dernières heures.
  const activity = quoteId
    ? await prisma.activityLog.findMany({
        where: { crmId: tenant.crmId, quoteId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { firstName: true, lastName: true, color: true } } },
      })
    : [];

  return {
    ok: true as const,
    tenant: { crmId: tenant.crmId, crmSlug: tenant.crmSlug, permissions: Array.from(tenant.permissions) },
    clients,
    prospects,
    vatRates,
    quote,
    activity,
    defaultConditions,
    defaultMentions,
    currentUserId: ctx.user.id,
  };
}

// ---------------------------------------------------------------------------
// Création / mise à jour
// ---------------------------------------------------------------------------

export async function saveQuote(
  crmId: string,
  quoteId: string | null,
  rawInput: unknown,
  actorCtx?: AuthContext
): Promise<QuoteActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);

  const parsed = quoteSaveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  const input = parsed.data;

  // Un devis est rattaché soit à un client, soit à un prospect (jamais les
  // deux) : on résout la partie concernée une seule fois, puis on retrouve
  // partout où le code utilisait auparavant `client.*`.
  let party: { id: string; company: string; siret: string | null };
  if (input.clientId) {
    const client = await prisma.client.findUnique({ where: { id: input.clientId } });
    if (!client) return { ok: false, error: "Client introuvable." };
    assertBelongsToCrm(client.crmId, tenant, "Client");
    party = client;
  } else {
    const prospect = await prisma.prospect.findUnique({ where: { id: input.prospectId! } });
    if (!prospect) return { ok: false, error: "Prospect introuvable." };
    assertBelongsToCrm(prospect.crmId, tenant, "Prospect");
    party = prospect;
  }

  const vatRateIds = Array.from(new Set(input.items.map((i) => i.vatRateId)));
  const vatRates = await prisma.vatRate.findMany({ where: { id: { in: vatRateIds }, crmId: tenant.crmId } });
  if (vatRates.length !== vatRateIds.length) {
    return { ok: false, error: "Un ou plusieurs taux de TVA sont invalides pour ce CRM." };
  }
  const vatRatesById = new Map(vatRates.map((v) => [v.id, Number(v.rate)]));

  const totals = computeTotals(input.items, vatRatesById);

  // Chaque ligne est bornée séparément, mais c'est bien leur somme qui part
  // dans totalHt/totalVat/totalTtc, en Decimal(12, 2) : sans ce contrôle,
  // un devis fait de lignes individuellement valides peut encore déborder
  // la colonne et faire échouer l'écriture côté base.
  if ([totals.totalHt, totals.totalVat, totals.totalTtc].some((v) => v > MAX_DECIMAL_12_2)) {
    return { ok: false, error: `Le total du devis dépasse le maximum autorisé (${MAX_DECIMAL_12_2.toLocaleString("fr-FR")} €).` };
  }

  if (!quoteId) {
    const number = await generateQuoteNumber(tenant.crmId);
    const quote = await prisma.quote.create({
      data: {
        crmId: tenant.crmId,
        number,
        clientId: input.clientId,
        prospectId: input.prospectId,
        object: input.object,
        siretSnapshot: party.siret,
        issueDate: input.issueDate,
        validUntil: input.validUntil,
        status: "DRAFT",
        conditions: input.conditions ?? null,
        mentions: input.mentions ?? null,
        totalHt: totals.totalHt,
        totalVat: totals.totalVat,
        totalTtc: totals.totalTtc,
        currentVersion: 1,
        createdById: ctx.user.id,
        items: {
          create: totals.lines.map((line, index) => ({
            designation: line.designation,
            quantity: line.quantity,
            unitPriceHt: line.unitPriceHt,
            vatRateId: line.vatRateId,
            order: index,
          })),
        },
      },
    });

    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "quote.created",
      entityType: "QUOTE",
      entityId: quote.id,
      quoteId: quote.id,
      clientId: input.clientId ?? undefined,
      prospectId: input.prospectId ?? undefined,
      newValue: { number, object: quote.object, totalTtc: totals.totalTtc },
    });
    await notifyCrm({
      crmId: tenant.crmId,
      type: "QUOTE_CREATED",
      title: `Nouveau devis ${number} — ${party.company}`,
      entityType: "QUOTE",
      entityId: quote.id,
      actorId: ctx.user.id,
      excludeUserIds: [ctx.user.id],
    });
    await publishToCrm(tenant.crmId, "quote.upserted", { id: quote.id });
    revalidatePath(`/c/${tenant.crmSlug}/quotes`);

    if (input.prospectId) {
      await advanceProspectOpportunityStage(tenant.crmId, input.prospectId, "Devis", ctx.user.id);
      revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
    }

    return { ok: true, quoteId: quote.id };
  }

  const existing = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!existing) return { ok: false, error: "Devis introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Devis");

  const wasSent = SENT_LIKE_STATUSES.includes(existing.status);

  await prisma.$transaction(async (tx) => {
    if (wasSent) {
      await tx.quoteVersion.create({
        data: {
          quoteId: existing.id,
          versionNumber: existing.currentVersion,
          authorId: ctx.user.id,
          note: "Snapshot automatique avant modification d'un devis déjà envoyé.",
          snapshot: {
            number: existing.number,
            clientId: existing.clientId,
            object: existing.object,
            siretSnapshot: existing.siretSnapshot,
            issueDate: existing.issueDate,
            validUntil: existing.validUntil,
            status: existing.status,
            conditions: existing.conditions,
            mentions: existing.mentions,
            totalHt: existing.totalHt,
            totalVat: existing.totalVat,
            totalTtc: existing.totalTtc,
            items: existing.items.map((i) => ({
              designation: i.designation,
              quantity: i.quantity,
              unitPriceHt: i.unitPriceHt,
              vatRateId: i.vatRateId,
              order: i.order,
            })),
          },
        },
      });
    }

    await tx.quoteItem.deleteMany({ where: { quoteId: existing.id } });
    await tx.quote.update({
      where: { id: existing.id },
      data: {
        clientId: input.clientId,
        prospectId: input.prospectId,
        object: input.object,
        siretSnapshot: party.siret,
        issueDate: input.issueDate,
        validUntil: input.validUntil,
        conditions: input.conditions ?? null,
        mentions: input.mentions ?? null,
        totalHt: totals.totalHt,
        totalVat: totals.totalVat,
        totalTtc: totals.totalTtc,
        currentVersion: wasSent ? existing.currentVersion + 1 : existing.currentVersion,
        items: {
          create: totals.lines.map((line, index) => ({
            designation: line.designation,
            quantity: line.quantity,
            unitPriceHt: line.unitPriceHt,
            vatRateId: line.vatRateId,
            order: index,
          })),
        },
      },
    });
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "quote.updated",
    entityType: "QUOTE",
    entityId: existing.id,
    quoteId: existing.id,
    clientId: input.clientId ?? undefined,
    prospectId: input.prospectId ?? undefined,
    oldValue: { totalTtc: Number(existing.totalTtc) },
    newValue: { totalTtc: totals.totalTtc, versioned: wasSent },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "QUOTE_UPDATED",
    title: `Devis ${existing.number} mis à jour`,
    entityType: "QUOTE",
    entityId: existing.id,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "quote.upserted", { id: existing.id });
  revalidatePath(`/c/${tenant.crmSlug}/quotes`);
  revalidatePath(`/c/${tenant.crmSlug}/quotes/${existing.id}`);

  if (input.prospectId) {
    await advanceProspectOpportunityStage(tenant.crmId, input.prospectId, "Devis", ctx.user.id);
    revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
  }

  return { ok: true, quoteId: existing.id };
}

export async function deleteQuote(crmId: string, quoteId: string, actorCtx?: AuthContext): Promise<QuoteActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.DELETE);
  const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!existing) return { ok: false, error: "Devis introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Devis");
  if (existing.status !== "DRAFT") {
    return { ok: false, error: "Seuls les devis en brouillon peuvent être supprimés." };
  }

  // Document.quoteId est en onDelete: Cascade — les lignes seront
  // supprimées automatiquement, mais pas les fichiers physiques : à
  // effacer explicitement avant, sans quoi ils restent orphelins.
  const quoteDocs = await prisma.document.findMany({ where: { quoteId }, select: { storageKey: true } });
  await removeStorageKeys(quoteDocs.map((d) => d.storageKey));

  await prisma.quote.delete({ where: { id: quoteId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "quote.deleted",
    entityType: "QUOTE",
    entityId: quoteId,
    oldValue: { number: existing.number },
  });
  await publishToCrm(tenant.crmId, "quote.upserted", { id: quoteId, deleted: true });
  revalidatePath(`/c/${tenant.crmSlug}/quotes`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transitions de statut
// ---------------------------------------------------------------------------

export async function setQuoteStatus(
  crmId: string,
  quoteId: string,
  status: QuoteStatus,
  actorCtx?: AuthContext
): Promise<QuoteActionResult> {
  const ctx = actorCtx ?? (await requireAuth());
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);
  const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!existing) return { ok: false, error: "Devis introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Devis");

  if (status === "SENT") {
    return { ok: false, error: "Utilisez l'action d'envoi pour passer un devis à « Envoyé »." };
  }
  const allowed = QUOTE_STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(status)) {
    return { ok: false, error: `Transition de ${existing.status} vers ${status} non autorisée.` };
  }

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status,
      acceptedAt: status === "ACCEPTED" ? new Date() : existing.acceptedAt,
      refusedAt: status === "REFUSED" ? new Date() : existing.refusedAt,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "quote.status_changed",
    entityType: "QUOTE",
    entityId: quoteId,
    quoteId,
    oldValue: { status: existing.status },
    newValue: { status },
  });
  await notifyCrm({
    crmId: tenant.crmId,
    type: "QUOTE_UPDATED",
    title: `Devis ${existing.number} : ${status}`,
    entityType: "QUOTE",
    entityId: quoteId,
    actorId: ctx.user.id,
    excludeUserIds: [ctx.user.id],
  });
  await publishToCrm(tenant.crmId, "quote.upserted", { id: quoteId });
  revalidatePath(`/c/${tenant.crmSlug}/quotes`);
  revalidatePath(`/c/${tenant.crmSlug}/quotes/${quoteId}`);
  return { ok: true, quoteId };
}

// ---------------------------------------------------------------------------
// PDF : génération + attachement au dossier documents
// ---------------------------------------------------------------------------

export interface GeneratePdfResult {
  ok: boolean;
  error?: string;
  documentId?: string;
  fileName?: string;
}

export async function generateAndStoreQuotePdf(crmId: string, quoteId: string): Promise<GeneratePdfResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Devis introuvable." };
  assertBelongsToCrm(quote.crmId, tenant, "Devis");

  const rendered = await renderQuotePdfBuffer(quoteId);
  if (!rendered) return { ok: false, error: "Impossible de générer le PDF." };

  const driver = getStorageDriver();
  const { storageKey } = await driver.put({
    buffer: rendered.buffer,
    fileName: rendered.fileName,
    crmId: tenant.crmId,
    mimeType: "application/pdf",
  });

  const document = await prisma.document.create({
    data: {
      crmId: tenant.crmId,
      fileName: rendered.fileName,
      mimeType: "application/pdf",
      size: rendered.buffer.length,
      storageKey,
      entityType: "QUOTE",
      entityId: quoteId,
      uploadedById: ctx.user.id,
      quoteId,
      clientId: quote.clientId,
      prospectId: quote.prospectId,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "quote.pdf_generated",
    entityType: "QUOTE",
    entityId: quoteId,
    quoteId,
    clientId: quote.clientId ?? undefined,
    prospectId: quote.prospectId ?? undefined,
    newValue: { fileName: rendered.fileName },
  });
  revalidatePath(`/c/${tenant.crmSlug}/quotes/${quoteId}`);

  return { ok: true, documentId: document.id, fileName: rendered.fileName };
}

// ---------------------------------------------------------------------------
// Envoi par email (mailto) : passage à SENT + génération PDF + contenu email
// ---------------------------------------------------------------------------

const DEFAULT_SUBJECT = "Votre devis {{numero_devis}} — {{entreprise}}";
const DEFAULT_BODY = `Bonjour {{prenom}} {{nom}},

Veuillez trouver ci-joint le devis {{numero_devis}} d'un montant de {{montant_devis}} concernant {{entreprise}}.

N'hésitez pas à me contacter pour toute question.

Cordialement,
{{commercial}}`;

function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

export interface SendQuoteResult {
  ok: boolean;
  error?: string;
  documentId?: string;
  fileName?: string;
  clientEmail: string | null;
  subject: string;
  body: string;
}

/**
 * Prépare l'envoi d'un devis : fait passer le statut en SENT si besoin (et
 * fixe sentAt), régénère le PDF (nouvelle version stockée en Document, sans
 * jamais écraser une génération précédente), puis construit le sujet/corps
 * de l'email (mailto) à partir du modèle EmailTemplate("quote_sent") du CRM
 * s'il existe, sinon d'un modèle par défaut.
 */
export async function sendQuote(crmId: string, quoteId: string): Promise<SendQuoteResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { client: true, prospect: true, createdBy: { select: { firstName: true, lastName: true } } },
  });
  if (!quote) return { ok: false, error: "Devis introuvable.", clientEmail: null, subject: "", body: "" };
  assertBelongsToCrm(quote.crmId, tenant, "Devis");

  // Un devis peut être rattaché à un client ou à un prospect : on utilise la
  // partie disponible pour l'email, le titre de notification, etc.
  const party = quote.client ?? quote.prospect;
  if (!party) return { ok: false, error: "Devis sans client ni prospect associé.", clientEmail: null, subject: "", body: "" };

  if (quote.status === "DRAFT") {
    await prisma.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: new Date() } });
    await logActivity({
      crmId: tenant.crmId,
      userId: ctx.user.id,
      action: "quote.sent",
      entityType: "QUOTE",
      entityId: quoteId,
      quoteId,
      clientId: quote.clientId ?? undefined,
      prospectId: quote.prospectId ?? undefined,
      newValue: { status: "SENT" },
    });
    await notifyCrm({
      crmId: tenant.crmId,
      type: "QUOTE_UPDATED",
      title: `Devis ${quote.number} envoyé à ${party.company}`,
      entityType: "QUOTE",
      entityId: quoteId,
      actorId: ctx.user.id,
      excludeUserIds: [ctx.user.id],
    });
    await publishToCrm(tenant.crmId, "quote.upserted", { id: quoteId });
    revalidatePath(`/c/${tenant.crmSlug}/quotes`);
    revalidatePath(`/c/${tenant.crmSlug}/quotes/${quoteId}`);

    if (quote.prospectId) {
      await advanceProspectOpportunityStage(tenant.crmId, quote.prospectId, "Devis", ctx.user.id);
      revalidatePath(`/c/${tenant.crmSlug}/pipeline`);
    }
  }

  const pdfResult = await generateAndStoreQuotePdf(crmId, quoteId);

  const emailTemplate = await prisma.emailTemplate.findUnique({
    where: { crmId_key: { crmId: tenant.crmId, key: "quote_sent" } },
  });

  const vars: Record<string, string> = {
    prenom: party.firstName ?? "",
    nom: party.lastName ?? "",
    entreprise: party.company,
    commercial: `${quote.createdBy.firstName} ${quote.createdBy.lastName}`,
    numero_devis: quote.number,
    montant_devis: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(quote.totalTtc)),
  };

  const subject = substituteTemplate(emailTemplate?.subject ?? DEFAULT_SUBJECT, vars);
  const body = substituteTemplate(emailTemplate?.body ?? DEFAULT_BODY, vars);

  return {
    ok: pdfResult.ok,
    error: pdfResult.error,
    documentId: pdfResult.documentId,
    fileName: pdfResult.fileName,
    clientEmail: party.email,
    subject,
    body,
  };
}

// ---------------------------------------------------------------------------
// Consultation d'une version archivée
// ---------------------------------------------------------------------------

export async function getQuoteVersion(crmId: string, quoteId: string, versionId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_QUOTES);
  const version = await prisma.quoteVersion.findUnique({
    where: { id: versionId },
    include: { author: { select: { firstName: true, lastName: true } }, quote: { select: { crmId: true, id: true } } },
  });
  if (!version || version.quote.id !== quoteId) return { ok: false as const, error: "Version introuvable." };
  assertBelongsToCrm(version.quote.crmId, tenant, "Devis");
  return { ok: true as const, version };
}
