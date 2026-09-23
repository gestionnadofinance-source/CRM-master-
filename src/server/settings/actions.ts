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
import { MAX_CODE, MAX_LONG, MAX_SHORT, MAX_TEXT, tooLong, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS, MAX_INT4, outOfRange } from "@/lib/validation";

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
  legalName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  logoUrl: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  address: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  postalCode: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  city: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  siret: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  phone: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  website: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  legalMentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  ape: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  urssafOffice: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  legalRepresentative: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  missionOrderLegalMentions: z.string().trim().max(MAX_LONG, tooLong(MAX_LONG)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
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
