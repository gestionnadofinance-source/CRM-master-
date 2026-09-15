import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Structure standard appliquée à tout nouveau CRM : pipeline, sources,
 * taux de TVA, réservation publique, compteur de devis. C'est le mécanisme
 * qui garantit qu'un 6e (ou 7e...) CRM peut être ajouté depuis l'admin sans
 * écrire une ligne de code : toute la logique métier tient ici.
 */
const DEFAULT_STAGES: { name: string; order: number; color: string; isWon?: boolean; isLost?: boolean }[] = [
  { name: "Nouveau prospect", order: 0, color: "#94a3b8" },
  { name: "Contact établi", order: 1, color: "#60a5fa" },
  { name: "Rendez-vous", order: 2, color: "#38bdf8" },
  { name: "Devis", order: 3, color: "#a78bfa" },
  { name: "Négociation", order: 4, color: "#fbbf24" },
  { name: "Gagné", order: 5, color: "#34d399", isWon: true },
  { name: "Perdu", order: 6, color: "#f87171", isLost: true },
];

const DEFAULT_SOURCES = [
  "Site internet",
  "Téléphone",
  "Email",
  "Prospection",
  "Recommandation",
  "Réseaux sociaux",
  "Publicité",
  "Salon",
  "Ancien client",
  "Autre",
];

const DEFAULT_VAT_RATES: { label: string; rate: number; isDefault: boolean }[] = [
  { label: "20% (taux normal)", rate: 20, isDefault: true },
  { label: "10% (taux intermédiaire)", rate: 10, isDefault: false },
  { label: "5,5% (taux réduit)", rate: 5.5, isDefault: false },
  { label: "0% (exonéré)", rate: 0, isDefault: false },
];

/** Normalise un texte libre en slug URL-safe (minuscules, tirets, sans accents). */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "crm";
}

/** Ajoute un suffixe numérique jusqu'à obtenir une valeur inexistante (slug de CRM ou de réservation). */
async function uniqueValue(base: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
  let candidate = base;
  let i = 2;
  while (await exists(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  return candidate;
}

/** Dérive un préfixe de 2 à 5 lettres majuscules à partir du nom du CRM, pour la numérotation des devis. */
export function derivePrefix(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  let prefix: string;
  if (words.length >= 2) {
    prefix = words.map((w) => w[0]).join("").slice(0, 5);
  } else {
    prefix = (words[0] ?? "CRM").slice(0, 5);
  }
  if (prefix.length < 2) {
    prefix = (words[0] ?? "CRM").slice(0, 5).padEnd(2, "X");
  }
  return prefix;
}

export interface ProvisionCrmInput {
  name: string;
  slug?: string;
  color?: string;
  description?: string | null;
  icon?: string;
}

export interface ProvisionCrmResult {
  id: string;
  slug: string;
  name: string;
}

/**
 * Crée un CRM complet et immédiatement opérationnel : Crm + CompanySettings
 * + BookingSettings (avec un publicSlug unique) + pipeline par défaut +
 * sources par défaut + taux de TVA par défaut + compteur de devis initial.
 * Tout se fait dans une transaction : soit le CRM est intégralement prêt,
 * soit rien n'est créé.
 */
export async function provisionCrm(input: ProvisionCrmInput): Promise<ProvisionCrmResult> {
  const baseSlug = slugify(input.slug && input.slug.trim() ? input.slug : input.name);
  const slug = await uniqueValue(baseSlug, async (candidate) => {
    const existing = await prisma.crm.findUnique({ where: { slug: candidate } });
    return Boolean(existing);
  });

  const bookingSlug = await uniqueValue(slug, async (candidate) => {
    const existing = await prisma.bookingSettings.findUnique({ where: { publicSlug: candidate } });
    return Boolean(existing);
  });

  const prefix = derivePrefix(input.name);
  const order = (await prisma.crm.count()) + 1;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const crm = await tx.crm.create({
      data: {
        name: input.name.trim(),
        slug,
        color: input.color ?? "#3b6bf5",
        description: input.description ?? null,
        icon: input.icon ?? "building",
        order,
      },
    });

    await tx.companySettings.create({ data: { crmId: crm.id, legalName: crm.name } });
    await tx.bookingSettings.create({ data: { crmId: crm.id, publicSlug: bookingSlug } });

    await tx.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((s) => ({ crmId: crm.id, ...s })),
    });

    await tx.source.createMany({
      data: DEFAULT_SOURCES.map((name, order) => ({ crmId: crm.id, name, order })),
    });

    await tx.vatRate.createMany({
      data: DEFAULT_VAT_RATES.map((v) => ({ crmId: crm.id, label: v.label, rate: v.rate, isDefault: v.isDefault })),
    });

    await tx.quoteCounter.create({
      data: { crmId: crm.id, prefix, year: new Date().getFullYear(), lastNumber: 0 },
    });

    return crm;
  });

  return { id: result.id, slug: result.slug, name: result.name };
}
