import "server-only";

// Aides communes aux routes d'écriture sous src/app/api/public/v1/** —
// voir src/server/public-api/auth.ts (requireWriteAccess).

import { NextResponse } from "next/server";
import { AuthError } from "@/server/auth/session";

/**
 * Convertit un corps JSON en FormData, pour pouvoir réutiliser tel quel
 * les server actions existantes (createClient, createTask...) qui
 * attendent un FormData — sans toucher à leur logique de parsing. Un
 * tableau devient plusieurs entrées sous la même clé (compatible avec
 * `formData.getAll`), toute autre valeur devient sa représentation
 * `String()` (compatible avec les schémas zod `z.coerce.*` et les champs
 * booléens "true"/"false" utilisés par ces actions).
 */
export function jsonToFormData(body: unknown): FormData {
  const fd = new FormData();
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) fd.append(key, String(item));
      } else {
        fd.set(key, String(value));
      }
    }
  }
  return fd;
}

function omit<T extends object>(obj: T, keys: string[]): Record<string, unknown> {
  const copy = { ...obj } as unknown as Record<string, unknown>;
  for (const k of keys) delete copy[k];
  return copy;
}

interface ActionResultLike {
  ok: boolean;
  error?: string;
  duplicate?: { id: string; company: string };
}

/**
 * Traduit le résultat d'une server action réutilisée telle quelle (voir
 * requireWriteAccess) en réponse HTTP JSON : `{ ok: false, error }` → 400
 * (ou 409 en cas de doublon détecté), `{ ok: true, ... }` → `successStatus`
 * avec le reste des champs (ex. `chantierId`).
 */
export function actionResultResponse<T extends ActionResultLike>(result: T, successStatus = 200): NextResponse {
  if (!result.ok) {
    if (result.duplicate) {
      return NextResponse.json({ error: result.error ?? "Doublon détecté.", duplicate: result.duplicate }, { status: 409 });
    }
    return NextResponse.json({ error: result.error ?? "Requête invalide." }, { status: 400 });
  }
  return NextResponse.json(omit(result, ["ok"]), { status: successStatus });
}

/**
 * Les server actions réutilisées ici lèvent parfois `AuthError` (CRM
 * introuvable/désactivé, permission insuffisante) plutôt que de la
 * retourner dans un `ActionResult` — à traduire en réponse HTTP plutôt que
 * de laisser l'erreur remonter en 500.
 */
export async function withWriteErrorHandling(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "CRM_ACCESS_DENIED" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    // Tout le reste est inattendu : les server actions réutilisées ici
    // rendent leurs erreurs métier dans un `ActionResult` (traduit par
    // actionResultResponse), pas en levant. Renvoyer `err.message` au
    // client exposerait donc des détails internes — requête Prisma, nom de
    // colonne, chaîne de connexion tronquée. Le détail va au journal
    // serveur, l'appelant reçoit un message stable.
    console.error("[public-api] erreur non gérée sur une route d'écriture", err);

    // Seule exception : les erreurs Prisma dont le code désigne sans
    // ambiguïté une requête fautive côté appelant (référence inconnue,
    // valeur trop longue...). Elles méritent un 4xx pour rester
    // exploitables, avec un libellé fixe qui ne cite ni table ni colonne.
    const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (code === "P2025") {
      return NextResponse.json({ error: "Ressource introuvable." }, { status: 404 });
    }
    if (code === "P2002") {
      return NextResponse.json({ error: "Une ressource équivalente existe déjà." }, { status: 409 });
    }
    if (code === "P2000" || code === "P2003" || code === "P2011" || code === "P2012") {
      return NextResponse.json({ error: "Requête invalide : référence ou valeur incorrecte." }, { status: 400 });
    }

    return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
  }
}
