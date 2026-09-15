"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { passwordSchema } from "@/lib/validation";
import { assertLoginNotRateLimited, recordLoginAttempt } from "@/server/auth/rate-limit";
import {
  createSession,
  destroyCurrentSession,
  getAuthContext,
  requireAuth,
  revokeSession,
} from "@/server/auth/session";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function clientIp(): Promise<string | undefined> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
}

/** Crée la session et redirige selon l'état du compte (changement de mot de passe obligatoire ou non). */
async function completeLogin(userId: string): Promise<never> {
  await createSession(userId);
  await prisma.user.update({ where: { id: userId }, data: { presence: "ONLINE", lastActiveAt: new Date() } });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.mustChangePassword) {
    redirect("/first-login");
  }
  redirect("/home");
}

/**
 * Identifiants et mots de passe sont entièrement gérés par un
 * administrateur (création de compte, régénération ou définition directe
 * du mot de passe — voir src/server/admin/actions.ts) : il n'y a ni 2FA ni
 * réinitialisation en self-service par email. La connexion se résume donc
 * à une simple vérification email + mot de passe.
 */
export async function loginStep1(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();

  if (!email || !password) {
    return { ok: false, error: "Email et mot de passe requis." };
  }

  try {
    await assertLoginNotRateLimited(email, ip);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk || user.status !== "ACTIVE") {
    await recordLoginAttempt(email, ip, false);
    return { ok: false, error: "Identifiants incorrects." };
  }

  await recordLoginAttempt(email, ip, true);
  return completeLogin(user.id);
}

export async function revokeOwnSession(sessionId: string): Promise<void> {
  const ctx = await requireAuth();
  await revokeSession(sessionId, ctx.user.id);
  revalidatePath("/settings");
}

export async function logout(): Promise<void> {
  const ctx = await getAuthContext();
  if (ctx) {
    await prisma.user.update({ where: { id: ctx.user.id }, data: { presence: "OFFLINE" } });
  }
  await destroyCurrentSession();
  redirect("/login");
}

/** Première connexion : le mot de passe temporaire devient inutilisable après ce changement obligatoire. */
export async function setFirstPassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password !== confirm) return { ok: false, error: "Les mots de passe ne correspondent pas." };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Mot de passe invalide." };

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: ctx.user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  redirect("/home");
}

export async function changePassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) return { ok: false, error: "Mot de passe actuel incorrect." };
  if (password !== confirm) return { ok: false, error: "Les mots de passe ne correspondent pas." };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Mot de passe invalide." };

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return { ok: true };
}
