import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
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
 * Point d'entrée cron pour la purge des données de limitation de fréquence :
 * tentatives de connexion (email + IP, 90 jours) et compteurs de
 * fréquence (7 jours). Ce sont des données personnelles dont la rétention
 * est annoncée dans le README (section RGPD) : sans ce déclenchement
 * périodique, elles s'accumuleraient indéfiniment.
 *
 * IMPORTANT — emplacement de la route : ce handler vit sous `/api/public/...`
 * (et non `/api/cron/...`) car `src/proxy.ts` exige un cookie de session sur
 * toute route qui ne commence pas par `/api/public`, `/book/`, `/_next` ou
 * `/favicon`. Un ordonnanceur externe n'a jamais de session navigateur :
 * sous `/api/cron`, cette route aurait été systématiquement redirigée vers
 * `/login` avant même d'atteindre le code ci-dessous. La sécurité réelle
 * reste entièrement portée par le secret `CRON_SECRET` vérifié plus bas — le
 * préfixe `/api/public` ne l'expose pas publiquement, il la rend seulement
 * atteignable sans cookie de session.
 *
 * Ordonnanceur : Vercel Cron invoque en GET et ajoute automatiquement
 * `Authorization: Bearer $CRON_SECRET` dès que cette variable existe sur le
 * projet. Le POST + en-tête `x-cron-secret` reste accepté pour un
 * déclenchement manuel ou un ordonnanceur externe.
 *
 * `CRON_SECRET` n'est pas déclarée dans `src/lib/env.ts` : elle est lue
 * directement. Tant qu'elle n'est pas définie, cette route répond 401 à
 * toute requête (fail-closed).
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const bearer = request.headers.get("authorization");
  if (bearer && timingSafeStringEqual(bearer, `Bearer ${expected}`)) return true;

  const provided = request.headers.get("x-cron-secret");
  return !!provided && timingSafeStringEqual(provided, expected);
}

async function runPurge(): Promise<NextResponse> {
  const [purgedLoginAttempts, purgedRateLimitHits] = await Promise.all([
    purgeOldLoginAttempts(),
    purgeOldRateLimitHits(),
  ]);

  return NextResponse.json({ ok: true, purgedLoginAttempts, purgedRateLimitHits });
}

// Même message qu'un secret invalide, y compris quand CRON_SECRET est absent
// de l'environnement : distinguer les deux cas dans la réponse renseignerait
// un appelant anonyme sur l'état de configuration du déploiement.
function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return runPurge();
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return runPurge();
}
