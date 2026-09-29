"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { depositMissionOrderCore } from "@/server/mission-order/core";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Génère l'ordre de mission et le dépose dans le coffre-fort individuel du salarié. */
export async function depositMissionOrder(crmId: string, chantierId: string, employeeId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId } });
  if (!chantier) return { ok: false, error: "Chantier introuvable." };
  assertBelongsToCrm(chantier.crmId, tenant, "Chantier");

  const member = await prisma.userCrmAccess.findUnique({ where: { userId_crmId: { userId: employeeId, crmId: tenant.crmId } } });
  if (!member) return { ok: false, error: "Cette personne n'a pas accès à ce CRM." };

  return depositMissionOrderCore(tenant, ctx.user.id, chantierId, chantier.name, employeeId);
}
