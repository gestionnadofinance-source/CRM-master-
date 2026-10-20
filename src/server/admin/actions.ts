"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { CrmRole, AccessCategory } from "@/server/permissions";
import { hashPassword, generateTemporaryPassword } from "@/lib/crypto";
import { passwordSchema, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";
import { sendEmail } from "@/lib/email";
import { buildWelcomeEmail, loginUrlFor, resolveAppOrigin } from "@/server/admin/welcome-email";
import { purgeTargets, purgeUsersCore } from "@/server/admin/purge-users";
import { PURGE_CONFIRMATION } from "@/lib/purge-confirmation";
import {
  prepareDraft,
  googleClientConfig,
  decryptRefreshToken,
  revokeRefreshToken,
  type DraftResult,
} from "@/server/google/gmail";
import { getServerEnv } from "@/lib/env";
import { logActivity } from "@/server/activity";
import { computeAccessDiff } from "@/server/admin/access-diff";
import { MAX_CODE, MAX_ID, MAX_SHORT, tooLong } from "@/lib/validation";

async function requireGlobalAdmin() {
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) throw new Error("Réservé aux administrateurs.");
  return ctx;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

const accessEntrySchema = z.object({
  crmId: z.string().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  role: z.nativeEnum(CrmRole),
  category: z.nativeEnum(AccessCategory),
  // Profil "chef de chantier" (catégorie OUVRIER uniquement) : voir
  // src/server/pointage. Choisi comme un profil de la personne, pas comme
  // un rôle propre à chaque chantier.
  isForeman: z.coerce.boolean().default(false),
  // Taux horaire de base (catégorie OUVRIER uniquement) — sert au calcul de
  // la majoration nuit (taux horaire x % de majoration), voir
  // src/server/pointage/calc.ts. Pré-rempli sur chaque nouvelle fiche,
  // modifiable ensuite par le chef de chantier.
  defaultHourlyRate: z.coerce.number().min(0).max(1000).default(0),
  // Montants par défaut des primes de pointage (catégorie OUVRIER
  // uniquement) — voir src/server/pointage. Ignorés pour la catégorie
  // OUVRIER. (Management/zone/masque/poste sont fixées par chantier, pas
  // par salarié — voir ChantierFixedAmounts — donc absentes ici.)
  defaultHousingAllowance: z.coerce.number().min(0).max(10000).default(0),
  defaultDirtAllowance: z.coerce.number().min(0).max(10000).default(5),
  /// Matricule du salarié dans le dossier Silae de cet espace — requis par
  /// l'export « Import Silae », voir src/server/silae.
  silaeMatricule: z
    .string()
    .trim()
    .max(MAX_CODE, tooLong(MAX_CODE))
    .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
    .default(""),
});

const createUserSchema = z.object({
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le prénom est obligatoire."),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le nom est obligatoire."),
  email: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).toLowerCase().email("Adresse email invalide."),
  isGlobalAdmin: z.boolean(),
  color: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  access: z.array(accessEntrySchema),
});

export interface CreateUserResult extends ActionResult {
  userId?: string;
  temporaryPassword?: string;
  emailDelivered?: boolean;
  /** Brouillon de bienvenue déposé dans le Gmail relié par l'administrateur (jamais envoyé). */
  gmailDraft?: DraftResult;
}

/** Adresse publique de l'application pour les liens des mails : voir resolveAppOrigin. */
async function appOrigin(): Promise<string> {
  let requestOrigin: string | null = null;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
      requestOrigin = `${proto}://${host}`;
    }
  } catch {
    // hors requête (tests) : repli ci-dessous
  }
  return resolveAppOrigin(process.env, requestOrigin, getServerEnv().APP_URL);
}

/**
 * Le select "profil" d'un espace porte 4 valeurs : OUVRIER, SECRETAIRE,
 * COMPTABLE, ou OUVRIER_FOREMAN (Ouvrier — Chef de chantier). Cette dernière se traduit
 * en category=OUVRIER + isForeman=true : le profil "chef de chantier" est
 * une variante de la catégorie Ouvrier, pas une catégorie à part.
 */
function parseAccessFromForm(formData: FormData) {
  const crmIds = formData.getAll("crmAccess").map(String);
  return crmIds.map((crmId) => {
    const profile = String(formData.get(`category-${crmId}`) ?? "OUVRIER");
    return {
      crmId,
      role: String(formData.get(`role-${crmId}`) ?? "USER"),
      category: profile === "OUVRIER_FOREMAN" ? "OUVRIER" : profile,
      isForeman: profile === "OUVRIER_FOREMAN",
      defaultHourlyRate: formData.get(`hourlyRate-${crmId}`) ?? undefined,
      defaultHousingAllowance: formData.get(`housing-${crmId}`) ?? undefined,
      defaultDirtAllowance: formData.get(`dirt-${crmId}`) ?? undefined,
      silaeMatricule: formData.get(`silae-${crmId}`) ?? undefined,
    };
  });
}

/** Crée un utilisateur, ses accès CRM, envoie l'invitation par email et journalise. */
export async function createUser(formData: FormData): Promise<CreateUserResult> {
  const ctx = await requireGlobalAdmin();

  const raw = {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    isGlobalAdmin: formData.get("isGlobalAdmin") === "on",
    color: String(formData.get("color") ?? "#3b6bf5"),
    access: parseAccessFromForm(formData),
  };
  const parsed = createUserSchema.safeParse(raw);
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
        isGlobalAdmin: input.isGlobalAdmin,
        color: input.color,
        mustChangePassword: true,
        createdById: ctx.user.id,
      },
    });
    if (!input.isGlobalAdmin && input.access.length > 0) {
      await tx.userCrmAccess.createMany({
        data: input.access.map((a) => ({
          userId: created.id,
          crmId: a.crmId,
          role: a.role,
          category: a.category,
          isForeman: a.isForeman,
          defaultHourlyRate: a.defaultHourlyRate,
          defaultHousingAllowance: a.defaultHousingAllowance,
          defaultDirtAllowance: a.defaultDirtAllowance,
          silaeMatricule: a.silaeMatricule || null,
          grantedById: ctx.user.id,
        })),
      });
    }
    return created;
  });

  // Compte Gmail relié : le mail de bienvenue est préparé en BROUILLON dans
  // la boîte de l'administrateur, qui le relit et l'envoie lui-même. Sinon,
  // envoi SMTP s'il est configuré, comme avant. Jamais les deux : le nouvel
  // utilisateur recevrait deux fois ses accès.
  let delivered = false;
  const gmailDraft = await prepareAccessDraft(ctx.user.id, {
    kind: "bienvenue",
    userId: user.id,
    firstName: user.firstName,
    email: user.email,
    temporaryPassword,
  });
  if (!gmailDraft) {
    const welcome = buildWelcomeEmail({
      firstName: user.firstName,
      email: user.email,
      temporaryPassword,
      loginUrl: loginUrlFor(await appOrigin(), user.email),
    });
    ({ delivered } = await sendEmail({ to: user.email, subject: welcome.subject, html: welcome.html, text: welcome.text }));
  }

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    newValue: { email: user.email, isGlobalAdmin: user.isGlobalAdmin, access: input.access },
  });

  revalidatePath("/admin/users");
  return { ok: true, userId: user.id, temporaryPassword, emailDelivered: delivered, gmailDraft };
}

/**
 * Prépare, dans le Gmail relié par l'administrateur, le brouillon des accès
 * d'un utilisateur. undefined si aucun compte n'est relié (l'appelant garde
 * alors son comportement habituel).
 */
async function prepareAccessDraft(
  adminUserId: string,
  u: { kind: "bienvenue" | "reinitialisation"; userId: string; firstName: string; email: string; temporaryPassword: string }
): Promise<DraftResult | undefined> {
  const linked = await prisma.googleMailAccount.findUnique({ where: { userId: adminUserId }, select: { id: true } });
  if (!linked) return undefined;
  const message = buildWelcomeEmail({
    kind: u.kind,
    firstName: u.firstName,
    email: u.email,
    temporaryPassword: u.temporaryPassword,
    loginUrl: loginUrlFor(await appOrigin(), u.email),
  });
  const result = await prepareDraft(adminUserId, { to: u.email, ...message });
  if (result.ok) {
    await logActivity({
      crmId: null,
      userId: adminUserId,
      action: u.kind === "bienvenue" ? "gmail.welcome_draft_prepared" : "gmail.password_draft_prepared",
      entityType: "User",
      entityId: u.userId,
      newValue: { to: u.email },
    });
  }
  return result;
}

/** Nombre de comptes que le nettoyage supprimerait, pour la confirmation. */
export async function countUsersToPurge(): Promise<number> {
  const ctx = await requireGlobalAdmin();
  return prisma.user.count({ where: purgeTargets(ctx.user.id) });
}

/**
 * Nettoyage : supprime tous les comptes sauf celui de l'administrateur qui le
 * lance, avec leurs données et leurs fichiers (voir purgeUsersCore).
 */
export async function purgeAllOtherUsers(
  confirmation: string
): Promise<ActionResult & { deletedUsers?: number; removedFiles?: number }> {
  const ctx = await requireGlobalAdmin();
  if (confirmation.trim() !== PURGE_CONFIRMATION) {
    return { ok: false, error: `Recopiez exactement « ${PURGE_CONFIRMATION} » pour confirmer.` };
  }
  const summary = await purgeUsersCore(ctx.user.id, purgeTargets(ctx.user.id));
  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.purge",
    entityType: "User",
    newValue: { deletedUsers: summary.deletedUsers, removedFiles: summary.removedFiles, emails: summary.deletedEmails },
  });
  revalidatePath("/admin/users");
  return { ok: true, deletedUsers: summary.deletedUsers, removedFiles: summary.removedFiles };
}

/**
 * Délie le compte Gmail de l'administrateur courant : l'autorisation est
 * retirée chez Google (au mieux) et le jeton supprimé de la base.
 */
export async function unlinkGmailAccount(): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const account = await prisma.googleMailAccount.findUnique({ where: { userId: ctx.user.id } });
  if (!account) return { ok: true };

  const cfg = googleClientConfig();
  const token = cfg ? decryptRefreshToken(account.refreshTokenEncrypted, cfg.clientSecret) : null;
  if (token) await revokeRefreshToken(token);
  await prisma.googleMailAccount.delete({ where: { id: account.id } });
  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "gmail.account_unlinked",
    entityType: "GoogleMailAccount",
    oldValue: { email: account.email },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

const updateUserSchema = z.object({
  firstName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le prénom est obligatoire."),
  lastName: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le nom est obligatoire."),
  isGlobalAdmin: z.boolean(),
  access: z.array(accessEntrySchema),
});

/** Met à jour les infos de base + la matrice d'accès CRM d'un utilisateur (create/update/delete des UserCrmAccess). */
export async function updateUserAccess(userId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();

  const target = await prisma.user.findUnique({ where: { id: userId }, include: { crmAccess: true } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };

  const raw = {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    isGlobalAdmin: formData.get("isGlobalAdmin") === "on",
    access: parseAccessFromForm(formData),
  };
  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  const input = parsed.data;

  if (target.isGlobalAdmin && !input.isGlobalAdmin && target.id === ctx.user.id) {
    return { ok: false, error: "Vous ne pouvez pas retirer vos propres droits d'administrateur global." };
  }

  const before = {
    isGlobalAdmin: target.isGlobalAdmin,
    access: target.crmAccess.map((a) => ({ crmId: a.crmId, role: a.role, category: a.category })),
  };

  const { toCreate, toUpdate, toDelete } = computeAccessDiff(target.crmAccess, input.access);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { firstName: input.firstName, lastName: input.lastName, isGlobalAdmin: input.isGlobalAdmin },
    });
    if (toCreate.length > 0) {
      await tx.userCrmAccess.createMany({
        data: toCreate.map((a) => ({
          userId,
          crmId: a.crmId,
          role: a.role,
          category: a.category,
          isForeman: a.isForeman,
          defaultHourlyRate: a.defaultHourlyRate,
          defaultHousingAllowance: a.defaultHousingAllowance,
          defaultDirtAllowance: a.defaultDirtAllowance,
          silaeMatricule: a.silaeMatricule || null,
          grantedById: ctx.user.id,
        })),
      });
    }
    for (const a of toUpdate) {
      await tx.userCrmAccess.update({
        where: { userId_crmId: { userId, crmId: a.crmId } },
        data: {
          role: a.role,
          category: a.category,
          isForeman: a.isForeman,
          defaultHourlyRate: a.defaultHourlyRate,
          defaultHousingAllowance: a.defaultHousingAllowance,
          defaultDirtAllowance: a.defaultDirtAllowance,
          silaeMatricule: a.silaeMatricule || null,
          grantedById: ctx.user.id,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.userCrmAccess.deleteMany({ where: { userId, crmId: { in: toDelete.map((a) => a.crmId) } } });
    }
  });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.access_updated",
    entityType: "User",
    entityId: userId,
    oldValue: before,
    newValue: { isGlobalAdmin: input.isGlobalAdmin, access: input.access },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/** Désactive un compte et révoque immédiatement toutes ses sessions actives. */
export async function disableUser(userId: string): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  if (userId === ctx.user.id) return { ok: false, error: "Vous ne pouvez pas désactiver votre propre compte." };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: "DISABLED", disabledAt: new Date() } }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.disabled",
    entityType: "User",
    entityId: userId,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };

  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE", disabledAt: null } });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.reactivated",
    entityType: "User",
    entityId: userId,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/**
 * Identifiants entièrement gérés par un administrateur : ni 2FA, ni
 * réinitialisation en self-service par email. Deux leviers, tous deux
 * révoquant les sessions actives de l'utilisateur (le mot de passe qu'il
 * connaissait n'est plus valide) :
 *  - regenerateUserPassword : génère un mot de passe temporaire aléatoire,
 *    affiché en clair à l'admin pour qu'il le communique lui-même ;
 *    l'utilisateur devra le changer à sa prochaine connexion.
 *  - setUserPassword : l'admin choisit lui-même le mot de passe exact.
 */
export async function regenerateUserPassword(
  userId: string
): Promise<ActionResult & { temporaryPassword?: string; gmailDraft?: DraftResult }> {
  const ctx = await requireGlobalAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Utilisateur introuvable." };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.password_regenerated",
    entityType: "User",
    entityId: userId,
  });

  // Compte Gmail relié : le mail des nouveaux accès est préparé en brouillon,
  // comme à la création. Sans compte relié, rien n'est envoyé — comme avant :
  // l'administrateur communique lui-même le mot de passe affiché.
  const gmailDraft = await prepareAccessDraft(ctx.user.id, {
    kind: "reinitialisation",
    userId: user.id,
    firstName: user.firstName,
    email: user.email,
    temporaryPassword,
  });

  return { ok: true, temporaryPassword, gmailDraft };
}

const setPasswordSchema = z.object({ password: passwordSchema });

export async function setUserPassword(userId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Utilisateur introuvable." };

  const parsed = setPasswordSchema.safeParse({ password: String(formData.get("password") ?? "") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Mot de passe invalide." };

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.password_set",
    entityType: "User",
    entityId: userId,
  });

  return { ok: true };
}

/** Supprime uniquement les entrées du journal d'activité de l'utilisateur — jamais son compte ni son travail. */
export async function deleteUserActivityHistory(userId: string, confirmEmail: string): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };
  if (target.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    return { ok: false, error: "L'email de confirmation ne correspond pas." };
  }

  const { count } = await prisma.activityLog.deleteMany({ where: { userId } });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.activity_history_deleted",
    entityType: "User",
    entityId: userId,
    newValue: { deletedCount: count },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/activity");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------





