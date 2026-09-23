import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Limitation de fréquence générique par IP, adossée à la base (donc fiable
 * en environnement serverless, contrairement à un compteur en mémoire qui
 * ne survit pas d'une invocation de fonction à l'autre). Même principe que
 * src/server/auth/rate-limit.ts (dédié au login), généralisé à tout point
 * d'entrée public non authentifié.
 */
export async function assertNotRateLimited(
  scope: string,
  identifier: string,
  { windowMinutes, maxAttempts }: { windowMinutes: number; maxAttempts: number }
): Promise<void> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const count = await prisma.rateLimitHit.count({
    where: { scope, identifier, createdAt: { gt: since } },
  });
  if (count >= maxAttempts) {
    throw new Error(`Trop de tentatives. Réessayez dans ${windowMinutes} minutes.`);
  }
}

export async function recordRateLimitHit(scope: string, identifier: string): Promise<void> {
  await prisma.rateLimitHit.create({ data: { scope, identifier } });
}

const RETENTION_DAYS = 7;

/**
 * Purge les entrées de plus de 7 jours : largement au-delà de toute fenêtre
 * de limitation de fréquence utilisée dans l'application (au maximum 60
 * minutes), ces lignes n'ont plus d'utilité. Appelée depuis la route cron
 * déjà programmée quotidiennement (voir
 * src/app/api/public/cron/purge/route.ts).
 */
export async function purgeOldRateLimitHits(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
