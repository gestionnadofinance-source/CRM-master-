"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { CustomFieldEntity, CustomFieldType, TagScope } from "@prisma/client";
import { isPubliclySafeHttpsUrl } from "@/lib/url-safety";
import { MAX_CODE, MAX_LONG, MAX_SHORT, MAX_TEXT, tooLong } from "@/lib/validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function guard(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId, Permission.MANAGE_SETTINGS);
  return { ctx, tenant };
}

function settingsPath(crmSlug: string) {
  return `/c/${crmSlug}/settings`;
}

async function afterChange(crmId: string, crmSlug: string, action: string, userId: string, extra?: Record<string, unknown>) {
  await logActivity({ crmId, userId, action, entityType: "CrmSettings", newValue: extra });
  await publishToCrm(crmId, "presence.updated", { reason: action });
  revalidatePath(settingsPath(crmSlug));
}

function friendlyConstraintError(err: unknown, fallback: string): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Foreign key constraint") || message.includes("foreign key")) {
    return { ok: false, error: "Impossible de supprimer : des éléments y sont encore rattachés." };
  }
  if (message.includes("Unique constraint")) {
    return { ok: false, error: "Cette valeur existe déjà." };
  }
  return { ok: false, error: fallback };
}

// ---------------------------------------------------------------------------
// Informations entreprise
// ---------------------------------------------------------------------------

const companySettingsSchema = z.object({
  legalName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)),
  logoUrl: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)),
  address: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)),
  postalCode: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)),
  city: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)),
  siret: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)),
  phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)),
  website: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)),
  legalMentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)),
  ape: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)),
  urssafOffice: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)),
  legalRepresentative: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)),
  missionOrderLegalMentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)),
});

export async function updateCompanySettings(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = companySettingsSchema.safeParse({
    legalName: formData.get("legalName") ?? "",
    logoUrl: formData.get("logoUrl") ?? "",
    address: formData.get("address") ?? "",
    postalCode: formData.get("postalCode") ?? "",
    city: formData.get("city") ?? "",
    siret: formData.get("siret") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    website: formData.get("website") ?? "",
    legalMentions: formData.get("legalMentions") ?? "",
    ape: formData.get("ape") ?? "",
    urssafOffice: formData.get("urssafOffice") ?? "",
    legalRepresentative: formData.get("legalRepresentative") ?? "",
    missionOrderLegalMentions: formData.get("missionOrderLegalMentions") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Formulaire invalide." };
  // Ce logo est ensuite récupéré côté serveur pour être intégré au PDF de
  // devis (voir server/quotes/pdf.tsx) : une URL non publique exposerait le
  // serveur à une SSRF aveugle (réseau interne, métadonnées cloud...).
  if (parsed.data.logoUrl && !isPubliclySafeHttpsUrl(parsed.data.logoUrl)) {
    return { ok: false, error: "L'URL du logo doit être une adresse https publique." };
  }

  await prisma.companySettings.upsert({
    where: { crmId },
    update: { ...parsed.data, logoUrl: parsed.data.logoUrl || null },
    create: { crmId, ...parsed.data, logoUrl: parsed.data.logoUrl || null },
  });

  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "company" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const stageSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  order: z.coerce.number().int(),
  color: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).min(1),
  isWon: z.boolean(),
  isLost: z.boolean(),
});

export async function createPipelineStage(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = stageSchema.safeParse({
    name: formData.get("name") ?? "",
    order: formData.get("order") ?? "0",
    color: formData.get("color") ?? "#94a3b8",
    isWon: formData.get("isWon") === "on",
    isLost: formData.get("isLost") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.pipelineStage.create({ data: { crmId, ...parsed.data } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "pipeline_stage_created" });
  return { ok: true };
}

export async function updatePipelineStage(
  crmId: string,
  crmSlug: string,
  stageId: string,
  formData: FormData
): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Étape introuvable." };

  const parsed = stageSchema.safeParse({
    name: formData.get("name") ?? "",
    order: formData.get("order") ?? "0",
    color: formData.get("color") ?? "#94a3b8",
    isWon: formData.get("isWon") === "on",
    isLost: formData.get("isLost") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.pipelineStage.update({ where: { id: stageId }, data: parsed.data });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "pipeline_stage_updated" });
  return { ok: true };
}

export async function deletePipelineStage(crmId: string, crmSlug: string, stageId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Étape introuvable." };

  try {
    await prisma.pipelineStage.delete({ where: { id: stageId } });
  } catch (err) {
    return friendlyConstraintError(err, "Suppression impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "pipeline_stage_deleted" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const sourceSchema = z.object({ name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."), order: z.coerce.number().int() });

export async function createSource(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = sourceSchema.safeParse({ name: formData.get("name") ?? "", order: formData.get("order") ?? "0" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await prisma.source.create({ data: { crmId, ...parsed.data } });
  } catch (err) {
    return friendlyConstraintError(err, "Création impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "source_created" });
  return { ok: true };
}

export async function updateSource(crmId: string, crmSlug: string, sourceId: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Source introuvable." };

  const parsed = sourceSchema.safeParse({ name: formData.get("name") ?? "", order: formData.get("order") ?? "0" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await prisma.source.update({ where: { id: sourceId }, data: parsed.data });
  } catch (err) {
    return friendlyConstraintError(err, "Modification impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "source_updated" });
  return { ok: true };
}

export async function deleteSource(crmId: string, crmSlug: string, sourceId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Source introuvable." };

  try {
    await prisma.source.delete({ where: { id: sourceId } });
  } catch (err) {
    return friendlyConstraintError(err, "Suppression impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "source_deleted" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  scope: z.nativeEnum(TagScope),
  color: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).min(1),
});

export async function createTag(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = tagSchema.safeParse({
    name: formData.get("name") ?? "",
    scope: formData.get("scope") ?? "CLIENT",
    color: formData.get("color") ?? "#94a3b8",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await prisma.tag.create({ data: { crmId, ...parsed.data } });
  } catch (err) {
    return friendlyConstraintError(err, "Création impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "tag_created" });
  return { ok: true };
}

export async function deleteTag(crmId: string, crmSlug: string, tagId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Tag introuvable." };

  await prisma.tag.delete({ where: { id: tagId } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "tag_deleted" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Champs personnalisés
// ---------------------------------------------------------------------------

const customFieldSchema = z.object({
  entityType: z.nativeEnum(CustomFieldEntity),
  label: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le libellé est obligatoire."),
  fieldType: z.nativeEnum(CustomFieldType),
  options: z.array(z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT))).transform((arr) => arr.filter(Boolean)),
  required: z.boolean(),
  order: z.coerce.number().int(),
});

export async function createCustomField(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = customFieldSchema.safeParse({
    entityType: formData.get("entityType") ?? "CLIENT",
    label: formData.get("label") ?? "",
    fieldType: formData.get("fieldType") ?? "TEXT",
    options: String(formData.get("options") ?? "").split(",").map((s) => s.trim()),
    required: formData.get("required") === "on",
    order: formData.get("order") ?? "0",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.customFieldDefinition.create({ data: { crmId, ...parsed.data } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "custom_field_created" });
  return { ok: true };
}

export async function deleteCustomField(crmId: string, crmSlug: string, fieldId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.customFieldDefinition.findUnique({ where: { id: fieldId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Champ introuvable." };

  await prisma.customFieldDefinition.delete({ where: { id: fieldId } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "custom_field_deleted" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Taux de TVA
// ---------------------------------------------------------------------------

const vatRateSchema = z.object({
  label: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le libellé est obligatoire."),
  rate: z.coerce.number().min(0).max(100),
  isDefault: z.boolean(),
});

export async function createVatRate(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = vatRateSchema.safeParse({
    label: formData.get("label") ?? "",
    rate: formData.get("rate") ?? "0",
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.vatRate.updateMany({ where: { crmId }, data: { isDefault: false } });
    }
    await tx.vatRate.create({ data: { crmId, ...parsed.data } });
  });

  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "vat_rate_created" });
  return { ok: true };
}

export async function deleteVatRate(crmId: string, crmSlug: string, vatRateId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.vatRate.findUnique({ where: { id: vatRateId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Taux introuvable." };

  try {
    await prisma.vatRate.delete({ where: { id: vatRateId } });
  } catch (err) {
    return friendlyConstraintError(err, "Suppression impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "vat_rate_deleted" });
  return { ok: true };
}

export async function setDefaultVatRate(crmId: string, crmSlug: string, vatRateId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.vatRate.findUnique({ where: { id: vatRateId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Taux introuvable." };

  await prisma.$transaction([
    prisma.vatRate.updateMany({ where: { crmId }, data: { isDefault: false } }),
    prisma.vatRate.update({ where: { id: vatRateId }, data: { isDefault: true } }),
  ]);

  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "vat_rate_default_changed" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Réservation en ligne
// ---------------------------------------------------------------------------

const bookingSchema = z.object({
  isEnabled: z.boolean(),
  slotDurationMinutes: z.coerce.number().int().min(5).max(480),
  bufferMinutes: z.coerce.number().int().min(0).max(240),
  minNoticeHours: z.coerce.number().int().min(0).max(720),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  balancedDistribution: z.boolean(),
  introMessage: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)),
});

export async function updateBookingSettings(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = bookingSchema.safeParse({
    isEnabled: formData.get("isEnabled") === "on",
    slotDurationMinutes: formData.get("slotDurationMinutes") ?? "30",
    bufferMinutes: formData.get("bufferMinutes") ?? "0",
    minNoticeHours: formData.get("minNoticeHours") ?? "24",
    maxAdvanceDays: formData.get("maxAdvanceDays") ?? "60",
    balancedDistribution: formData.get("balancedDistribution") === "on",
    introMessage: formData.get("introMessage") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  const existing = await prisma.bookingSettings.findUnique({ where: { crmId } });
  await prisma.bookingSettings.upsert({
    where: { crmId },
    update: { ...parsed.data, introMessage: parsed.data.introMessage || null },
    create: {
      crmId,
      publicSlug: existing?.publicSlug ?? crmId,
      ...parsed.data,
      introMessage: parsed.data.introMessage || null,
    },
  });

  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "booking" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Modèles de devis
// ---------------------------------------------------------------------------

const quoteTemplateSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  logoUrl: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)),
  primaryColor: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).min(1),
  mentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)),
  conditions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)),
  footer: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)),
  isDefault: z.boolean(),
});

export async function createQuoteTemplate(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = quoteTemplateSchema.safeParse({
    name: formData.get("name") ?? "",
    logoUrl: formData.get("logoUrl") ?? "",
    primaryColor: formData.get("primaryColor") ?? "#3b6bf5",
    mentions: formData.get("mentions") ?? "",
    conditions: formData.get("conditions") ?? "",
    footer: formData.get("footer") ?? "",
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  // Même contrôle que pour le logo des informations entreprise : ce champ
  // est récupéré côté serveur lors de la génération du PDF de devis.
  if (parsed.data.logoUrl && !isPubliclySafeHttpsUrl(parsed.data.logoUrl)) {
    return { ok: false, error: "L'URL du logo doit être une adresse https publique." };
  }

  await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.quoteTemplate.updateMany({ where: { crmId }, data: { isDefault: false } });
    }
    await tx.quoteTemplate.create({
      data: {
        crmId,
        ...parsed.data,
        logoUrl: parsed.data.logoUrl || null,
        mentions: parsed.data.mentions || null,
        conditions: parsed.data.conditions || null,
        footer: parsed.data.footer || null,
      },
    });
  });

  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "quote_template_created" });
  return { ok: true };
}

export async function deleteQuoteTemplate(crmId: string, crmSlug: string, templateId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.quoteTemplate.findUnique({ where: { id: templateId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Modèle introuvable." };

  await prisma.quoteTemplate.delete({ where: { id: templateId } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "quote_template_deleted" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Modèles d'emails
// ---------------------------------------------------------------------------

const emailTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "La clé est obligatoire.")
    .regex(/^[a-z0-9_.-]+$/, "La clé ne doit contenir que des lettres minuscules, chiffres, - _ ."),
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  subject: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "L'objet est obligatoire."),
  body: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).min(1, "Le corps est obligatoire."),
});

export async function createEmailTemplate(crmId: string, crmSlug: string, formData: FormData): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const parsed = emailTemplateSchema.safeParse({
    key: formData.get("key") ?? "",
    name: formData.get("name") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await prisma.emailTemplate.create({ data: { crmId, ...parsed.data } });
  } catch (err) {
    return friendlyConstraintError(err, "Création impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "email_template_created" });
  return { ok: true };
}

export async function updateEmailTemplate(
  crmId: string,
  crmSlug: string,
  templateId: string,
  formData: FormData
): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.emailTemplate.findUnique({ where: { id: templateId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Modèle introuvable." };

  const parsed = emailTemplateSchema.safeParse({
    key: formData.get("key") ?? existing.key,
    name: formData.get("name") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  try {
    await prisma.emailTemplate.update({ where: { id: templateId }, data: parsed.data });
  } catch (err) {
    return friendlyConstraintError(err, "Modification impossible.");
  }
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "email_template_updated" });
  return { ok: true };
}

export async function deleteEmailTemplate(crmId: string, crmSlug: string, templateId: string): Promise<ActionResult> {
  const { ctx } = await guard(crmId);
  const existing = await prisma.emailTemplate.findUnique({ where: { id: templateId } });
  if (!existing || existing.crmId !== crmId) return { ok: false, error: "Modèle introuvable." };

  await prisma.emailTemplate.delete({ where: { id: templateId } });
  await afterChange(crmId, crmSlug, "crm.settings_updated", ctx.user.id, { section: "email_template_deleted" });
  return { ok: true };
}
