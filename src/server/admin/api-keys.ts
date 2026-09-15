"use server";

// Émission/révocation des clés d'API (voir prisma/schema.prisma § API
// POUR INTÉGRATIONS EXTERNES et src/app/api/public/v1/**) — réservé aux
// administrateurs globaux. Une clé donne accès à toutes les données de
// tous les CRM ; son niveau de permission (lecture seule ou lecture +
// écriture), choisi une fois pour toutes à la création, détermine si les
// routes POST/PATCH/DELETE lui sont accessibles.

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { generateToken, hashToken } from "@/lib/crypto";
import { logActivity } from "@/server/activity";
import { revalidatePath } from "next/cache";
import { ApiKeyPermission } from "@prisma/client";

async function requireGlobalAdmin() {
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) throw new Error("Réservé aux administrateurs.");
  return ctx;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface CreateApiKeyResult extends ActionResult {
  key?: string;
}

const KEY_PREFIX = "cmk_";

/**
 * Crée une nouvelle clé d'API et renvoie sa valeur en clair — la SEULE
 * fois où elle est lisible : seul son hash est conservé en base (même
 * schéma que Session.tokenHash), donc une clé perdue ne peut être
 * récupérée, uniquement révoquée puis remplacée par une nouvelle.
 */
export async function createApiKey(name: string, permission: ApiKeyPermission): Promise<CreateApiKeyResult> {
  const ctx = await requireGlobalAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Le nom de la clé est obligatoire." };
  if (permission !== "READ_ONLY" && permission !== "READ_WRITE") {
    return { ok: false, error: "Permission invalide." };
  }

  const secret = generateToken(32);
  const key = `${KEY_PREFIX}${secret}`;
  const keyHash = hashToken(key);
  const keyPrefix = key.slice(0, 12);

  await prisma.apiKey.create({
    data: { name: trimmedName, keyHash, keyPrefix, permission, createdById: ctx.user.id },
  });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "api_key.created",
    entityType: "ApiKey",
    newValue: { name: trimmedName, keyPrefix, permission },
  });

  revalidatePath("/admin/api-keys");
  return { ok: true, key };
}

export async function listApiKeys() {
  await requireGlobalAdmin();
  return prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function revokeApiKey(id: string): Promise<ActionResult> {
  const ctx = await requireGlobalAdmin();
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) return { ok: false, error: "Clé introuvable." };
  if (key.revokedAt) return { ok: true };

  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });

  await logActivity({
    crmId: null,
    userId: ctx.user.id,
    action: "api_key.revoked",
    entityType: "ApiKey",
    entityId: id,
    oldValue: { name: key.name, keyPrefix: key.keyPrefix },
  });

  revalidatePath("/admin/api-keys");
  return { ok: true };
}
