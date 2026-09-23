import "server-only";
import { prisma } from "@/lib/prisma";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_EMAIL = 5;
const MAX_ATTEMPTS_PER_IP = 20;

export async function assertLoginNotRateLimited(email: string, ipAddress: string | undefined): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const failedForEmail = await prisma.loginAttempt.count({
    where: { email: email.toLowerCase(), success: false, createdAt: { gt: since } },
  });
  if (failedForEmail >= MAX_ATTEMPTS_PER_EMAIL) {
    throw new Error(
      `Trop de tentatives de connexion pour ce compte. Réessayez dans ${WINDOW_MINUTES} minutes.`
    );
  }

  if (ipAddress) {
    const failedForIp = await prisma.loginAttempt.count({
      where: { ipAddress, success: false, createdAt: { gt: since } },
    });
    if (failedForIp >= MAX_ATTEMPTS_PER_IP) {
      throw new Error(`Trop de tentatives de connexion depuis cette adresse. Réessayez dans ${WINDOW_MINUTES} minutes.`);
    }
  }
}

export async function recordLoginAttempt(email: string, ipAddress: string | undefined, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.toLowerCase(), ipAddress, success },
  });
}

const RETENTION_DAYS = 90;

/**
 * Purge les tentatives de connexion de plus de 90 jours : au-delà de la
 * fenêtre de limitation de fréquence (15 minutes), ces lignes (email + IP,
 * donnée à caractère personnel) n'ont plus d'utilité fonctionnelle et
 * n'ont pas vocation à s'accumuler indéfiniment. Appelée depuis la route
 * cron déjà programmée quotidiennement (voir
 * src/app/api/public/cron/purge/route.ts).
 */
export async function purgeOldLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
