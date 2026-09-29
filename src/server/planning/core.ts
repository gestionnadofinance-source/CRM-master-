import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/server/auth/session";
import { requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { logActivity } from "@/server/activity";
import { publishToCrm } from "@/lib/realtime";
import { revalidatePath } from "next/cache";
import { CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";

/**
 * Cœur des mutations de chantier, SANS contrôle d'accès embarqué au niveau du
 * contexte : chaque cœur reçoit un AuthContext DÉJÀ établi.
 *
 * Vit hors du module "use server" à dessein : là-bas, tout export est une
 * action appelable depuis le navigateur avec des arguments arbitraires, donc
 * un paramètre de contexte y serait forgeable. Le contexte n'est légitime que
 * construit côté serveur (session vérifiée, ou clé API).
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  chantierId?: string;
}

export function revalidatePlanning(crmSlug: string): void {
  revalidatePath(`/c/${crmSlug}/planning`);
  revalidatePath("/admin/planning");
}


const decimalField = z.coerce.number().min(0).max(99999.99).optional().or(z.literal("").transform(() => undefined));

const chantierSchema = z.object({
  name: z.string().trim().min(1, "Le nom du chantier est requis.").max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
  description: z.string().trim().max(2000).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  address: z.string().trim().max(300).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED"]).optional(),

  lunchAllowance: decimalField,
  dinnerAllowance: decimalField,
  travelAllowance: decimalField,
  maskBonus: decimalField,
  managementBonus: decimalField,
  zoneBonus: decimalField,
  postBonus: decimalField,
  mealAllowance: decimalField,
  clothingBonus: decimalField,

  missionNature: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  clientName: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  siteContactName: z.string().trim().max(200).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  siteContactPhone: z.string().trim().max(50).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
  importantDocuments: z.string().trim().max(1000).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional().or(z.literal("")),
});

export async function createChantierCore(ctx: AuthContext, crmId: string, formData: FormData): Promise<ActionResult> {
  const tenant = await requireOperationsAccess(ctx, crmId);

  const parsed = chantierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: "La date de fin doit être postérieure à la date de début." };
  }

  const chantier = await prisma.chantier.create({
    data: {
      crmId: tenant.crmId,
      name: parsed.data.name,
      description: parsed.data.description || undefined,
      address: parsed.data.address || undefined,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      color: parsed.data.color ?? "#0891b2",
      createdById: ctx.user.id,
      lunchAllowance: parsed.data.lunchAllowance ?? 0,
      dinnerAllowance: parsed.data.dinnerAllowance ?? 0,
      travelAllowance: parsed.data.travelAllowance ?? 0,
      maskBonus: parsed.data.maskBonus ?? 0,
      managementBonus: parsed.data.managementBonus ?? 0,
      zoneBonus: parsed.data.zoneBonus ?? 0,
      postBonus: parsed.data.postBonus ?? 0,
      mealAllowance: parsed.data.mealAllowance ?? 9.81,
      clothingBonus: parsed.data.clothingBonus ?? 0,
      missionNature: parsed.data.missionNature || undefined,
      clientName: parsed.data.clientName || undefined,
      siteContactName: parsed.data.siteContactName || undefined,
      siteContactPhone: parsed.data.siteContactPhone || undefined,
      importantDocuments: parsed.data.importantDocuments || undefined,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.created",
    entityType: "CHANTIER",
    entityId: chantier.id,
    newValue: { name: chantier.name },
  });
  await publishToCrm(tenant.crmId, "notification.created", { kind: "chantier", entityId: chantier.id });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true, chantierId: chantier.id };
}


export async function updateChantierCore(ctx: AuthContext, crmId: string, chantierId: string, formData: FormData): Promise<ActionResult> {
  const tenant = await requireOperationsAccess(ctx, crmId);

  const existing = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!existing) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Chantier");

  const parsed = chantierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: "La date de fin doit être postérieure à la date de début." };
  }

  await prisma.chantier.update({
    where: { id: chantierId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      address: parsed.data.address || null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      color: parsed.data.color ?? existing.color,
      status: parsed.data.status ?? existing.status,
      lunchAllowance: parsed.data.lunchAllowance ?? 0,
      dinnerAllowance: parsed.data.dinnerAllowance ?? 0,
      travelAllowance: parsed.data.travelAllowance ?? 0,
      maskBonus: parsed.data.maskBonus ?? 0,
      managementBonus: parsed.data.managementBonus ?? 0,
      zoneBonus: parsed.data.zoneBonus ?? 0,
      postBonus: parsed.data.postBonus ?? 0,
      mealAllowance: parsed.data.mealAllowance ?? 9.81,
      clothingBonus: parsed.data.clothingBonus ?? 0,
      missionNature: parsed.data.missionNature || null,
      clientName: parsed.data.clientName || null,
      siteContactName: parsed.data.siteContactName || null,
      siteContactPhone: parsed.data.siteContactPhone || null,
      importantDocuments: parsed.data.importantDocuments || null,
    },
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.updated",
    entityType: "CHANTIER",
    entityId: chantierId,
  });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}


export async function deleteChantierCore(ctx: AuthContext, crmId: string, chantierId: string): Promise<ActionResult> {
  const tenant = await requireOperationsAccess(ctx, crmId);

  const existing = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!existing) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(existing.crmId, tenant, "Chantier");

  await prisma.chantier.delete({ where: { id: chantierId } });
  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "chantier.deleted",
    entityType: "CHANTIER",
    entityId: chantierId,
    oldValue: { name: existing.name },
  });
  revalidatePlanning(tenant.crmSlug);
  return { ok: true };
}
