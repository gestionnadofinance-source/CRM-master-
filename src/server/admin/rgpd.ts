"use server";

// Outillage RGPD pour un compte User (salarié) — remplace la procédure
// manuelle documentée dans README.md § "Données personnelles (RGPD)" par
// deux actions depuis /admin : export JSON (article 15, accès/portabilité)
// et anonymisation d'un compte déjà désactivé (article 17, effacement).
// Ne couvre volontairement que les Users : Client/Prospect suivent une
// procédure distincte (suppression de l'entité, qui nettoie déjà le
// stockage physique — voir README § Documents et stockage).

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { logActivity } from "@/server/activity";
import { revalidatePath } from "next/cache";

async function requireGlobalAdmin() {
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) throw new Error("Réservé aux administrateurs.");
  return ctx;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ExportResult extends ActionResult {
  data?: Record<string, unknown>;
}

/**
 * Export JSON de toutes les données personnelles d'un utilisateur (article
 * 15 RGPD — droit d'accès/portabilité), selon la cartographie documentée
 * dans README.md. Remplace l'étape manuelle "interroger chaque table
 * filtrée sur cette personne via Prisma Studio" par un export en un clic.
 * Disponible quel que soit le statut du compte (actif ou désactivé) : ce
 * n'est qu'une lecture, jamais une modification.
 */
export async function exportUserPersonalData(userId: string): Promise<ExportResult> {
  const ctx = await requireGlobalAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Utilisateur introuvable." };

  const [crmAccess, sessions, loginAttempts, messages, activityLog, pointagesAsEmployee] = await Promise.all([
    prisma.userCrmAccess.findMany({
      where: { userId },
      select: { crmId: true, role: true, category: true, isForeman: true, grantedAt: true },
    }),
    prisma.session.findMany({
      where: { userId },
      select: { ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.loginAttempt.findMany({
      // LoginAttempt est indexé par email (pas de userId en base), voir
      // prisma/schema.prisma — la personne n'y est identifiable qu'ainsi.
      where: { email: user.email },
      select: { ipAddress: true, success: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: { authorId: userId },
      select: { crmId: true, threadId: true, body: true, createdAt: true, editedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { userId },
      select: { crmId: true, action: true, entityType: true, entityId: true, oldValue: true, newValue: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.pointage.findMany({
      where: { employeeId: userId },
      select: { crmId: true, chantierId: true, weekStart: true, days: true, comments: true, createdAt: true },
      orderBy: { weekStart: "desc" },
    }),
  ]);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.personal_data_exported",
    entityType: "User",
    entityId: userId,
  });

  return {
    ok: true,
    data: {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        signatureText: user.signatureText,
        signatureImageUrl: user.signatureImageUrl,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      },
      crmAccess,
      sessions,
      loginAttempts,
      messagesAuthored: messages,
      activityLog,
      pointagesAsEmployee,
    },
  };
}

/**
 * Anonymise un compte utilisateur déjà désactivé (article 17 RGPD — droit
 * à l'effacement) : remplace firstName/lastName/email/avatar/signature par
 * des valeurs anonymes, sans supprimer la ligne elle-même — une
 * suppression physique casserait l'intégrité référentielle des devis,
 * messages et tâches que ce compte a créés (voir README § Données
 * personnelles, qui documente cette même règle pour la procédure
 * manuelle). Exige que le compte soit déjà désactivé, pour ne jamais
 * anonymiser un salarié encore actif par erreur.
 */
export async function anonymizeUser(userId: string, confirmEmail: string): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  if (userId === ctx.user.id) {
    return { ok: false, error: "Vous ne pouvez pas anonymiser votre propre compte." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "Utilisateur introuvable." };
  if (target.status !== "DISABLED") {
    return { ok: false, error: "Désactivez d'abord ce compte avant de l'anonymiser." };
  }
  if (target.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    return { ok: false, error: "L'email de confirmation ne correspond pas." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        firstName: "Utilisateur",
        lastName: "anonymisé",
        email: `anonymized-${userId}@anonymized.local`,
        avatarUrl: null,
        signatureText: null,
        signatureImageUrl: null,
      },
    }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "user.anonymized",
    entityType: "User",
    entityId: userId,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}
