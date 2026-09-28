import "server-only";
import { prisma } from "@/lib/prisma";
import { publishToCrm } from "@/lib/realtime";

export interface LogActivityInput {
  crmId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Durée de conservation du journal d'activité : 12 mois.
 *
 * Plus long que les 7 jours des tables de limitation de fréquence, parce que
 * ce journal a une valeur métier — retrouver qui a modifié quoi sur un
 * exercice écoulé — mais borné quand même : une ligne est écrite à CHAQUE
 * opération, sans quoi la table croît indéfiniment (défaut relevé en phase
 * d'endurance). Douze mois couvrent un exercice comptable complet.
 */
const RETENTION_DAYS = 365;

/**
 * Supprime par lots pour ne pas tenir un verrou long sur une table qui peut
 * être volumineuse au premier passage — contrairement à LoginAttempt et
 * RateLimitHit, purgées chaque semaine et donc toujours petites. Le plafond
 * borne la durée d'une exécution : le reliquat part au passage suivant, la
 * purge étant quotidienne.
 */
const BATCH_SIZE = 5_000;
const MAX_BATCHES = 20;

export async function purgeOldActivityLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let total = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await prisma.activityLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const { count } = await prisma.activityLog.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    total += count;
    if (batch.length < BATCH_SIZE) break;
  }

  return total;
}

/** Journalise une action métier. Ne doit jamais faire échouer l'opération appelante. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        crmId: input.crmId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        oldValue: input.oldValue === undefined ? undefined : (input.oldValue as object),
        newValue: input.newValue === undefined ? undefined : (input.newValue as object),
      },
    });
    if (input.crmId) {
      await publishToCrm(input.crmId, "notification.created", {
        kind: "activity",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    }
  } catch (err) {
    console.error("[activity] échec de journalisation", err);
  }
}
