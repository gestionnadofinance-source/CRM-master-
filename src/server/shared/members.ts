import "server-only";
import { prisma } from "@/lib/prisma";
import type { AccessCategory } from "@prisma/client";

export interface CrmMember {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
  /** OUVRIER pour un ouvrier ou un chef de chantier, SECRETAIRE pour un accès transverse. Null pour un administrateur global (pas de catégorie propre). */
  category: AccessCategory | null;
  isGlobalAdmin: boolean;
}

/**
 * Liste des utilisateurs pouvant être choisis comme commercial / collaborateur
 * pour ce CRM : ceux ayant un UserCrmAccess actif sur ce crmId, plus les
 * administrateurs globaux (qui ont accès à tous les CRM implicitement).
 *
 * Retourne tout le monde avec sa catégorie — c'est à chaque appelant de
 * filtrer selon son besoin (ex : n'afficher que les commerciaux dans un
 * sélecteur donné) plutôt qu'à cette fonction de décider pour tous ses
 * appelants, dont les besoins diffèrent (ex : la messagerie autorise les
 * admins mais pas les ouvriers, l'affectation d'un rendez-vous ni l'un ni
 * l'autre).
 */
export async function listCrmMembers(crmId: string): Promise<CrmMember[]> {
  const [access, globalAdmins] = await Promise.all([
    prisma.userCrmAccess.findMany({
      where: { crmId },
      include: { user: { select: { id: true, firstName: true, lastName: true, color: true, status: true } } },
    }),
    prisma.user.findMany({
      where: { isGlobalAdmin: true, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, color: true },
    }),
  ]);

  const byId = new Map<string, CrmMember>();
  for (const a of access) {
    if (a.user.status !== "ACTIVE") continue;
    byId.set(a.user.id, {
      id: a.user.id,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      color: a.user.color,
      category: a.category,
      isGlobalAdmin: false,
    });
  }
  for (const admin of globalAdmins) {
    byId.set(admin.id, { ...admin, category: null, isGlobalAdmin: true });
  }
  return Array.from(byId.values()).sort((a, b) => a.firstName.localeCompare(b.firstName));
}
