import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { runNoActivitySweep } from "@/server/automations/engine";
import { purgeOldLoginAttempts } from "@/server/auth/rate-limit";
import { purgeOldRateLimitHits } from "@/lib/rate-limit";

/**
 * Compare deux chaînes en temps constant (indépendant du nombre de
 * caractères corrects en préfixe) pour un secret d'authentification —
 * `===` fuit cette information par sa durée d'exécution, exploitable en
 * théorie par une attaque par mesure de temporisation. La comparaison de
 * longueur reste, elle, immédiate : elle ne révèle rien de sensible (la
 * longueur seule ne permet pas de reconstituer le secret).
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Point d'entrée cron pour le moteur d'automatisations.
 *
 * IMPORTANT — emplacement de la route : ce handler vit sous `/api/public/...`
 * (et non `/api/cron/...`) car `src/proxy.ts` (non modifiable depuis ce
 * module) exige un cookie de session sur toute route qui ne commence pas par
 * `/api/public`, `/book/`, `/_next` ou `/favicon`. Un ordonnanceur externe
 * n'a jamais de session navigateur : sous `/api/cron`, cette route aurait été
 * systématiquement redirigée vers `/login` par le middleware avant même
 * d'atteindre le code ci-dessous. La sécurité réelle de cette route reste
 * entièrement portée par le secret `CRON_SECRET` vérifié plus bas — le
 * préfixe `/api/public` ne l'expose pas publiquement, il la rend seulement
 * atteignable sans cookie de session.
 *
 * Ordonnanceur : Vercel Cron (entrée `crons` dans vercel.json, une fois par
 * jour, suffisant pour `NO_ACTIVITY_SINCE`) — Vercel invoque en GET et
 * ajoute automatiquement `Authorization: Bearer $CRON_SECRET` dès que cette
 * variable d'environnement existe sur le projet. Le POST + en-tête
 * `x-cron-secret` reste accepté pour un déclenchement manuel ou un
 * ordonnanceur externe.
 *
 * Sécurité : nécessite `Authorization: Bearer $CRON_SECRET` (GET, Vercel
 * Cron) OU l'en-tête `x-cron-secret` égal à `CRON_SECRET` (POST, manuel).
 * `CRON_SECRET` N'EST PAS déclarée dans `src/lib/env.ts` (schéma central non
 * modifiable depuis ce module) : elle est lue directement via
 * `process.env.CRON_SECRET`. Tant qu'elle n'est pas définie, cette route
 * répond 401 à toute requête (fail-closed).
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const bearer = request.headers.get("authorization");
  if (bearer && timingSafeStringEqual(bearer, `Bearer ${expected}`)) return true;

  const provided = request.headers.get("x-cron-secret");
  return !!provided && timingSafeStringEqual(provided, expected);
}

async function runSweep(): Promise<NextResponse> {
  const crms = await prisma.crm.findMany({ where: { isActive: true }, select: { id: true, slug: true } });

  const results: Record<string, number> = {};
  for (const crm of crms) {
    const { tasksCreated } = await runNoActivitySweep(crm.id);
    results[crm.slug] = tasksCreated;
  }

  // Purge des données de limitation de fréquence devenues inutiles (voir
  // DATA-03) : profite du même déclenchement quotidien plutôt que d'ajouter
  // une seconde route cron pour une tâche de cette taille.
  const [purgedLoginAttempts, purgedRateLimitHits] = await Promise.all([
    purgeOldLoginAttempts(),
    purgeOldRateLimitHits(),
  ]);

  return NextResponse.json({ ok: true, results, purgedLoginAttempts, purgedRateLimitHits });
}

// Même message qu'un secret invalide, y compris quand CRON_SECRET est absent
// de l'environnement : distinguer les deux cas dans la réponse renseignerait
// un appelant anonyme sur l'état de configuration du déploiement. Le détail
// utile au diagnostic reste dans les logs serveur (voir isAuthorized).
function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return runSweep();
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return runSweep();
}
