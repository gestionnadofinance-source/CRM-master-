"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { CrmRole, AccessCategory } from "@/server/permissions";
import { hashPassword, generateTemporaryPassword } from "@/lib/crypto";
import { passwordSchema, CONTROL_CHARS_MESSAGE, NO_CONTROL_CHARS } from "@/lib/validation";
import { sendEmail, baseEmailLayout } from "@/lib/email";
import { getServerEnv } from "@/lib/env";
import { logActivity } from "@/server/activity";
import { provisionCrm } from "@/server/admin/provision-crm";
import { publishToCrm } from "@/lib/realtime";
import { computeAccessDiff } from "@/server/admin/access-diff";
import { MAX_CODE, MAX_ID, MAX_SHORT, MAX_TEXT, tooLong } from "@/lib/validation";

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
}

/**
 * Le select "profil" d'un espace porte 3 valeurs : OUVRIER, SECRETAIRE, ou
 * OUVRIER_FOREMAN (Ouvrier — Chef de chantier). Cette dernière se traduit
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
          grantedById: ctx.user.id,
        })),
      });
    }
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
       <p>Un compte vient d'être créé pour vous sur CRM Master.</p>
       <p>Identifiant : <strong>${user.email}</strong><br/>
       Mot de passe temporaire : <strong>${temporaryPassword}</strong></p>
       <p>Il vous sera demandé de le changer dès la première connexion.</p>
       <p><a href="${loginUrl}" style="color:#1d3cd6;">Se connecter</a></p>`
    ),
  });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    newValue: { email: user.email, isGlobalAdmin: user.isGlobalAdmin, access: input.access },
  });

  revalidatePath("/admin/users");
  return { ok: true, userId: user.id, temporaryPassword, emailDelivered: delivered };
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
): Promise<ActionResult & { temporaryPassword?: string }> {
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

  return { ok: true, temporaryPassword };
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

const createCrmSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le nom est obligatoire."),
  slug: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(),
  color: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  description: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(),
});

export interface CreateCrmResult extends ActionResult {
  crmId?: string;
  crmSlug?: string;
}

export async function createCrm(formData: FormData): Promise<CreateCrmResult> {
  const ctx = await requireGlobalAdmin();
  const raw = {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim() || undefined,
    color: String(formData.get("color") ?? "#3b6bf5"),
    description: String(formData.get("description") ?? "").trim() || undefined,
  };
  const parsed = createCrmSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const crm = await provisionCrm(parsed.data);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "crm.created",
    entityType: "Crm",
    entityId: crm.id,
    newValue: { name: crm.name, slug: crm.slug },
  });

  revalidatePath("/admin/crms");
  revalidatePath("/", "layout");
  return { ok: true, crmId: crm.id, crmSlug: crm.slug };
}

const updateCrmSchema = z.object({
  name: z.string().trim().max(MAX_SHORT, tooLong(MAX_SHORT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1, "Le nom est obligatoire."),
  description: z.string().trim().max(MAX_TEXT, tooLong(MAX_TEXT)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).optional(),
  color: z.string().trim().max(MAX_CODE, tooLong(MAX_CODE)).regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE).min(1),
  isActive: z.boolean(),
});

/** Modifie un CRM existant. Le slug est volontairement immuable après création : toutes les URLs en dépendent. */
export async function updateCrm(crmId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const existing = await prisma.crm.findUnique({ where: { id: crmId } });
  if (!existing) return { ok: false, error: "CRM introuvable." };

  const raw = {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || undefined,
    color: String(formData.get("color") ?? "#3b6bf5"),
    isActive: formData.get("isActive") === "on",
  };
  const parsed = updateCrmSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  const input = parsed.data;

  await prisma.crm.update({
    where: { id: crmId },
    data: { name: input.name, description: input.description ?? null, color: input.color, isActive: input.isActive },
  });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "crm.updated",
    entityType: "Crm",
    entityId: crmId,
    oldValue: { name: existing.name, description: existing.description, color: existing.color, isActive: existing.isActive },
    newValue: input,
  });

  // Le nom du CRM n'est jamais mis en cache : les Server Components (topbar,
  // sidebar) le relisent en base à chaque navigation via requireCrmAccessBySlug.
  // revalidatePath force en plus l'invalidation du cache de rendu Next.js pour
  // que le nouveau nom apparaisse dès la prochaine requête, sans attendre une
  // expiration de cache quelconque.
  revalidatePath("/", "layout");
  revalidatePath("/admin/crms");
  revalidatePath(`/admin/crms/${crmId}`);

  // Signal best-effort pour les sessions déjà ouvertes avec Pusher configuré ;
  // n'a aucun effet si le temps réel n'est pas configuré (voir lib/realtime.ts).
  await publishToCrm(crmId, "presence.updated", { reason: "crm.renamed" });

  return { ok: true };
}
