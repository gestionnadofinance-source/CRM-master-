"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/auth/actions";

export async function updateOwnProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const color = String(formData.get("color") ?? "#3b6bf5");
  const signatureText = String(formData.get("signatureText") ?? "").trim() || null;
  const notifyByEmail = formData.get("notifyByEmail") === "on";

  if (!firstName || !lastName) {
    return { ok: false, error: "Le prénom et le nom sont obligatoires." };
  }

  await prisma.user.update({
    where: { id: ctx.user.id },
    data: { firstName, lastName, color, signatureText, notifyByEmail },
  });

  revalidatePath("/settings");
  return { ok: true };
}
