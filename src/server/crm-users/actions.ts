"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireOperationsAccess } from "@/server/tenant";
import { AccessCategory, CrmRole } from "@/server/permissions";
import { hashPassword, generateTemporaryPassword } from "@/lib/crypto";
import { sendEmail, baseEmailLayout } from "@/lib/email";
import { getServerEnv } from "@/lib/env";
import { logActivity } from "@/server/activity";
import { MAX_SHORT, tooLong } from "@/lib/validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Gestion des utilisateurs SCOPÉE À UN SEUL CRM, réservée aux
 * administrateurs de ce CRM et à la catégorie SECRETAIRE (voir
 * canManageOperations / requireOperationsAccess dans src/server/tenant.ts).
 * Contrairement à /admin/users (réservé à isGlobalAdmin, transverse à tous
 * les CRM), ces actions ne touchent JAMAIS que le UserCrmAccess du CRM
 * courant : jamais isGlobalAdmin, jamais l'accès d'un utilisateur à un
 * AUTRE CRM. Un administrateur global reste seul habilité à gérer les
 * comptes transverses.
 */

/** Liste les personnes ayant un accès à ce CRM (hors administrateurs globaux, gérés ailleurs). */
export async function listCrmUsers(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const access = await prisma.userCrmAccess.findMany({
    where: { crmId: tenant.crmId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          isGlobalAdmin: true,
          sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } },
        },
      },
    },
    orderBy: { user: { firstName: "asc" } },
  });

  return access
    .filter((a) => !a.user.isGlobalAdmin)
    .map((a) => ({
      userId: a.user.id,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      email: a.user.email,
      status: a.user.status,
      lastSeenAt: a.user.sessions[0]?.lastSeenAt ?? null,
      role: a.role,
      category: a.category,
      isForeman: a.isForeman,
    }));
}

const createSchema = z.object({
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le prénom est obligatoire."),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).toLowerCase().email("Adresse email invalide."),
  role: z.nativeEnum(CrmRole),
  category: z.nativeEnum(AccessCategory),
  isForeman: z.coerce.boolean().default(false),
});

export interface CreateCrmUserResult extends ActionResult {
  userId?: string;
  temporaryPassword?: string;
  emailDelivered?: boolean;
}

/** Crée un utilisateur avec un accès limité à CE seul CRM (jamais isGlobalAdmin, jamais d'autre CRM). */
export async function createCrmUser(crmId: string, formData: FormData): Promise<CreateCrmUserResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const raw = {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    role: String(formData.get("role") ?? "USER"),
    category: String(formData.get("category") ?? "COMMERCIAL"),
    isForeman: formData.get("isForeman") === "on",
  };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  const input = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { ok: false, error: "Un utilisateur avec cet email existe déjà." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
        isGlobalAdmin: false,
        color: "#3b6bf5",
        mustChangePassword: true,
        createdById: ctx.user.id,
      },
    });
    await tx.userCrmAccess.create({
      data: {
        userId: created.id,
        crmId: tenant.crmId,
        role: input.role,
        category: input.category,
        isForeman: input.category === "OUVRIER" ? input.isForeman : false,
        grantedById: ctx.user.id,
      },
    });
    return created;
  });

  const env = getServerEnv();
  const loginUrl = `${env.APP_URL}/login`;
  const { delivered } = await sendEmail({
    to: user.email,
    subject: "Bienvenue sur CRM Master",
    html: baseEmailLayout(
      "Bienvenue sur CRM Master",
      `<p>Bonjour ${user.firstName},</p>
       <p>Un compte vient d'être créé pour vous sur CRM Master (${tenant.crmName}).</p>
       <p>Identifiant : <strong>${user.email}</strong><br/>
       Mot de passe temporaire : <strong>${temporaryPassword}</strong></p>
       <p>Il vous sera demandé de le changer dès la première connexion.</p>
       <p><a href="${loginUrl}" style="color:#1d3cd6;">Se connecter</a></p>`
    ),
  });

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    newValue: { email: user.email, role: input.role, category: input.category },
  });

  revalidatePath(`/c/${tenant.crmSlug}/users`);
  return { ok: true, userId: user.id, temporaryPassword, emailDelivered: delivered };
}

const updateSchema = z.object({
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le prénom est obligatoire."),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).min(1, "Le nom est obligatoire."),
  role: z.nativeEnum(CrmRole),
  category: z.nativeEnum(AccessCategory),
  isForeman: z.coerce.boolean().default(false),
});

/** Vérifie que targetUserId a bien un accès (non-admin-global) à CE crm, et le retourne. */
async function requireCrmMember(crmId: string, targetUserId: string) {
  const access = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId: targetUserId, crmId } },
    include: { user: { select: { isGlobalAdmin: true } } },
  });
  if (!access || access.user.isGlobalAdmin) return null;
  return access;
}

/** Modifie le nom et l'accès (rôle/catégorie/chef de chantier) d'un membre de CE CRM uniquement. */
export async function updateCrmUserAccess(crmId: string, targetUserId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const member = await requireCrmMember(tenant.crmId, targetUserId);
  if (!member) return { ok: false, error: "Utilisateur introuvable dans ce CRM." };

  const raw = {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    role: String(formData.get("role") ?? "USER"),
    category: String(formData.get("category") ?? "COMMERCIAL"),
    isForeman: formData.get("isForeman") === "on",
  };
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  const input = parsed.data;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      data: { firstName: input.firstName, lastName: input.lastName },
    }),
    prisma.userCrmAccess.update({
      where: { userId_crmId: { userId: targetUserId, crmId: tenant.crmId } },
      data: {
        role: input.role,
        category: input.category,
        isForeman: input.category === "OUVRIER" ? input.isForeman : false,
        grantedById: ctx.user.id,
      },
    }),
  ]);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "user.access_updated",
    entityType: "User",
    entityId: targetUserId,
    newValue: { role: input.role, category: input.category },
  });

  revalidatePath(`/c/${tenant.crmSlug}/users`);
  return { ok: true };
}

/** Désactive un membre de CE CRM (révoque ses sessions actives). */
export async function disableCrmUser(crmId: string, targetUserId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);
  if (targetUserId === ctx.user.id) return { ok: false, error: "Vous ne pouvez pas désactiver votre propre compte." };

  const member = await requireCrmMember(tenant.crmId, targetUserId);
  if (!member) return { ok: false, error: "Utilisateur introuvable dans ce CRM." };

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { status: "DISABLED", disabledAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "user.disabled", entityType: "User", entityId: targetUserId });
  revalidatePath(`/c/${tenant.crmSlug}/users`);
  return { ok: true };
}

export async function reactivateCrmUser(crmId: string, targetUserId: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const member = await requireCrmMember(tenant.crmId, targetUserId);
  if (!member) return { ok: false, error: "Utilisateur introuvable dans ce CRM." };

  await prisma.user.update({ where: { id: targetUserId }, data: { status: "ACTIVE", disabledAt: null } });
  await logActivity({ crmId: tenant.crmId, userId: ctx.user.id, action: "user.reactivated", entityType: "User", entityId: targetUserId });
  revalidatePath(`/c/${tenant.crmSlug}/users`);
  return { ok: true };
}

/** Génère un nouveau mot de passe temporaire pour un membre de CE CRM (révoque ses sessions actives). */
export async function regenerateCrmUserPassword(
  crmId: string,
  targetUserId: string
): Promise<ActionResult & { temporaryPassword?: string }> {
  const ctx = await requireAuth();
  const tenant = await requireOperationsAccess(ctx, crmId);

  const member = await requireCrmMember(tenant.crmId, targetUserId);
  if (!member) return { ok: false, error: "Utilisateur introuvable dans ce CRM." };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { passwordHash, mustChangePassword: true } }),
    prisma.session.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({
    crmId: tenant.crmId,
    userId: ctx.user.id,
    action: "user.password_regenerated",
    entityType: "User",
    entityId: targetUserId,
  });
  return { ok: true, temporaryPassword };
}
