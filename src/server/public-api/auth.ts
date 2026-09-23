import "server-only";

// Authentification des routes publiques sous src/app/api/public/v1/** —
// voir prisma/schema.prisma § API POUR INTÉGRATIONS EXTERNES et
// src/server/admin/api-keys.ts (émission/révocation). Ces routes vivent
// sous /api/public/ pour la même raison que la route cron (voir
// src/app/api/public/cron/purge/route.ts) : src/proxy.ts exige
// un cookie de session sur toute route hors /api/public, et un client
// externe (Obsidian, un script...) n'en a jamais.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import type { AuthContext } from "@/server/auth/session";
import type { ApiKeyPermission } from "@prisma/client";

export interface ApiKeyContext {
  id: string;
  name: string;
  permission: ApiKeyPermission;
}

const ACTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  isGlobalAdmin: true,
  status: true,
  color: true,
  avatarUrl: true,
  theme: true,
  mustChangePassword: true,
} as const;

/**
 * Vérifie l'en-tête `Authorization: Bearer <clé>` contre les clés émises
 * (jamais stockées en clair, voir hashToken) et renvoie la clé + son
 * créateur, ou null si absente/invalide/révoquée. Met à jour lastUsedAt au
 * passage (purement informatif, affiché dans /admin/api-keys).
 */
async function findActiveApiKey(request: NextRequest) {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!bearer) return null;

  const keyHash = hashToken(bearer);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { createdBy: { select: ACTOR_SELECT } },
  });
  if (!apiKey || apiKey.revokedAt) return null;

  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  return apiKey;
}

/** À utiliser sur les routes GET — n'exige aucun niveau de permission particulier. */
export async function requireApiKey(request: NextRequest): Promise<ApiKeyContext | null> {
  const apiKey = await findActiveApiKey(request);
  if (!apiKey) return null;
  return { id: apiKey.id, name: apiKey.name, permission: apiKey.permission };
}

export function unauthorizedResponse() {
  return Response.json({ error: "Clé API absente, invalide ou révoquée." }, { status: 401 });
}

export function forbiddenWriteResponse() {
  return Response.json(
    { error: "Cette clé API est en lecture seule : elle ne permet aucune création, modification ou suppression." },
    { status: 403 }
  );
}

export type WriteAccessResult =
  | { ok: true; apiKey: ApiKeyContext; actor: AuthContext }
  | { ok: false; response: Response };

/**
 * À utiliser sur les routes POST/PATCH/DELETE : exige une clé API valide
 * ET de permission READ_WRITE, puis construit un `AuthContext` équivalent
 * à celui d'un administrateur global — le créateur de la clé, qui est
 * nécessairement administrateur global (voir requireGlobalAdmin dans
 * src/server/admin/api-keys.ts) — afin que les routes appellent tel quel
 * le cœur métier des server actions existantes (createClient, saveQuote,
 * upsertPointageEntry, etc. via leur paramètre optionnel `actorCtx`)
 * plutôt que de dupliquer leurs règles et leurs effets de bord
 * (notifications, journal d'activité, mouvements de pipeline...).
 */
export async function requireWriteAccess(request: NextRequest): Promise<WriteAccessResult> {
  const apiKey = await findActiveApiKey(request);
  if (!apiKey) return { ok: false, response: unauthorizedResponse() };
  if (apiKey.permission !== "READ_WRITE") return { ok: false, response: forbiddenWriteResponse() };

  return {
    ok: true,
    apiKey: { id: apiKey.id, name: apiKey.name, permission: apiKey.permission },
    actor: { user: apiKey.createdBy, sessionId: `apikey:${apiKey.id}` },
  };
}

/**
 * Lit `page`/`perPage` sur l'URL avec des bornes sûres — jamais de
 * requête non bornée sur une table qui grandit avec l'usage (voir
 * l'audit technique de ce projet, F2/F5 : les listes non paginées ou
 * plafonnées en silence sont un problème connu, corrigé ici dès la
 * conception plutôt qu'après coup).
 */
const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 500;

export function readPagination(request: NextRequest): { skip: number; take: number; page: number; perPage: number } {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(url.searchParams.get("perPage")) || DEFAULT_PER_PAGE));
  return { skip: (page - 1) * perPage, take: perPage, page, perPage };
}
