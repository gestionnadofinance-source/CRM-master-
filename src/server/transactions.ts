import "server-only";

import { prisma } from "@/lib/prisma";

export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Nombre total de tentatives (la première + les reprises), et attente
 * entre deux tentatives.
 *
 * Quand N requêtes concurrentes se disputent la même clé, la reprise de
 * toutes les perdantes repart en même temps et peut reproduire le conflit :
 * une attente aléatoire les désynchronise. Quatre reprises couvrent la
 * contention vérifiée en test (10 créations simultanées sur le même
 * SIRET, tests/duplicate-race.test.ts) ; au-delà, l'erreur remonte
 * plutôt que de faire attendre l'utilisateur indéfiniment.
 */
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 8;

function backoffDelay(attempt: number): number {
  return Math.round(BACKOFF_BASE_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
}

const SQLSTATES = new Set(["40001", "40P01"]); // échec de sérialisation, interblocage
const PRISMA_CODES = new Set(["P2034"]); // « write conflict or deadlock »

/**
 * Reconnaît un échec de sérialisation, sous toutes les formes qu'il peut
 * prendre en chemin.
 *
 * PostgreSQL le signale par le SQLSTATE 40001 (interblocage : 40P01).
 * Prisma le traduit normalement en P2034, mais avec un adaptateur de
 * driver (`@prisma/adapter-pg`) l'erreur remonte en `DriverAdapterError`,
 * qui porte le SQLSTATE dans `originalCode` et non `code`, et dont le
 * `message` vaut « TransactionWriteConflict » — le texte PostgreSQL, lui,
 * est dans `originalMessage`. On inspecte donc les trois formes, en
 * suivant la chaîne des `cause`, plutôt que de parier sur une seule.
 */
function isSerializationConflict(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; originalCode?: unknown; kind?: unknown; meta?: { code?: unknown }; originalMessage?: unknown; message?: unknown; cause?: unknown };

  for (const code of [e.code, e.originalCode, e.meta?.code]) {
    if (typeof code === "string" && (SQLSTATES.has(code) || PRISMA_CODES.has(code))) return true;
  }
  if (e.kind === "TransactionWriteConflict") return true;

  for (const text of [e.originalMessage, e.message]) {
    if (typeof text === "string" && /could not serialize|deadlock detected|transactionwriteconflict|write conflict/i.test(text)) return true;
  }

  return isSerializationConflict(e.cause, depth + 1);
}

/**
 * Exécute `fn` dans une transaction SERIALIZABLE, en reprenant les échecs
 * de sérialisation.
 *
 * Utilisé pour les séquences « lire puis écrire selon ce qu'on a lu » que
 * READ COMMITTED laisse passer en concurrence : deux créations simultanées
 * portant le même SIRET ne voient ni l'une ni l'autre de doublon et
 * insèrent toutes les deux. Sous SERIALIZABLE, PostgreSQL détecte le
 * fantôme et fait échouer l'une des deux ; la reprise relit alors la ligne
 * committée et emprunte la branche « doublon ».
 *
 * `fn` doit être rejouable : pas d'effet de bord hors transaction (journal
 * d'activité, notifications, revalidation) — ceux-ci restent à l'appelant,
 * après le commit.
 */
export async function runSerializable<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isSerializationConflict(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
    }
  }
}
