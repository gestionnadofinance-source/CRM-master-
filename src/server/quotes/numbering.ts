import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Dérive un préfixe de secours (3-4 lettres majuscules) à partir du nom du
 * CRM, uniquement utilisé si aucun QuoteCounter n'existe déjà pour ce CRM
 * (cas normalement impossible : chaque CRM est seedé avec un compteur).
 */
function derivePrefixFromCrmName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "DEV";
  if (words.length === 1) {
    return words[0]!.slice(0, 4).toUpperCase();
  }
  return words
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

/**
 * Trouve le préfixe déjà utilisé par ce CRM (n'importe quelle année) pour
 * rester cohérent d'une année sur l'autre. Ne crée jamais de préfixe
 * "inventé" si un compteur existe déjà quelque part pour ce CRM.
 */
async function resolveCrmPrefix(crmId: string): Promise<string> {
  const existing = await prisma.quoteCounter.findFirst({
    where: { crmId },
    orderBy: { year: "desc" },
    select: { prefix: true },
  });
  if (existing) return existing.prefix;

  const crm = await prisma.crm.findUnique({ where: { id: crmId }, select: { name: true } });
  return derivePrefixFromCrmName(crm?.name ?? "DEVIS");
}

/**
 * Génère un numéro de devis unique et séquentiel pour un CRM donné, au
 * format `${PREFIX}-${ANNEE}-${00001}`. L'incrémentation du compteur est
 * atomique (upsert avec `increment`), donc sûre en cas de créations
 * concurrentes de devis pour le même CRM.
 *
 * `prefixOverride` permet de forcer un préfixe précis (tests, migration) ;
 * en usage normal, on laisse la fonction retrouver le préfixe déjà attribué
 * au CRM via son QuoteCounter existant.
 */
export async function generateQuoteNumber(crmId: string, prefixOverride?: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = prefixOverride ?? (await resolveCrmPrefix(crmId));

  const counter = await prisma.quoteCounter.upsert({
    where: { crmId_prefix_year: { crmId, prefix, year } },
    create: { crmId, prefix, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });

  const padded = String(counter.lastNumber).padStart(5, "0");
  return `${prefix}-${year}-${padded}`;
}
