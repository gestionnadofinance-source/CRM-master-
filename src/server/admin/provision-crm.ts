import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Structure standard appliquée à tout nouvel espace. C'est le mécanisme
 * qui garantit qu'un espace supplémentaire peut être ajouté depuis
 * l'administration sans écrire une ligne de code : toute la logique tient
 * ici.
 */
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
 * Crée un espace complet et immédiatement opérationnel : Crm +
 * CompanySettings. Tout se fait dans une transaction : soit l'espace est
 * intégralement prêt, soit rien n'est créé.
 */
export async function provisionCrm(input: ProvisionCrmInput): Promise<ProvisionCrmResult> {
  const baseSlug = slugify(input.slug && input.slug.trim() ? input.slug : input.name);
  const slug = await uniqueValue(baseSlug, async (candidate) => {
    const existing = await prisma.crm.findUnique({ where: { slug: candidate } });
    return Boolean(existing);
  });

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

    return crm;
  });

  return { id: result.id, slug: result.slug, name: result.name };
}
