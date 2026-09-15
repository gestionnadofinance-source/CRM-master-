import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthContext } from "@/server/auth/session";
import { Permission, CrmRole, AccessCategory, effectivePermissions, hasPermission } from "@/server/permissions";

export interface TenantContext {
  crmId: string;
  crmSlug: string;
  crmName: string;
  role: CrmRole;
  category: AccessCategory;
  permissions: Set<Permission>;
  isGlobalAdmin: boolean;
}

const GLOBAL_ADMIN_ACCESS: AccessSummary = {
  role: CrmRole.MANAGER,
  category: AccessCategory.COMMERCIAL,
  permissions: Object.values(Permission),
};

interface AccessSummary {
  role: CrmRole;
  category: AccessCategory;
  permissions: Permission[];
}

/**
 * Porte d'entrée UNIQUE pour vérifier l'accès d'un utilisateur à un CRM.
 * Toute route API / server action / page qui manipule une donnée d'un CRM
 * doit passer par cette fonction — jamais faire confiance à un crmId
 * transmis par le client sans le revalider ici.
 *
 * Un administrateur global a accès à tous les CRM (gestion transverse),
 * mais chaque appel reste explicitement scoped à un crmId : les données
 * ne sont jamais retournées "toutes confondues".
 */
export async function requireCrmAccess(
  ctx: AuthContext,
  crmId: string,
  permission?: Permission
): Promise<TenantContext> {
  const crm = await prisma.crm.findUnique({ where: { id: crmId } });
  if (!crm || !crm.isActive) {
    throw new AuthError("CRM_ACCESS_DENIED", "Ce CRM est introuvable ou désactivé.");
  }

  let access: AccessSummary;
  if (ctx.user.isGlobalAdmin) {
    access = GLOBAL_ADMIN_ACCESS;
  } else {
    const record = await prisma.userCrmAccess.findUnique({
      where: { userId_crmId: { userId: ctx.user.id, crmId } },
    });
    if (!record) {
      throw new AuthError("CRM_ACCESS_DENIED", "Vous n'avez pas accès à ce CRM.");
    }
    access = record;
  }

  if (permission && !hasPermission(access, permission)) {
    throw new AuthError("FORBIDDEN", "Permission insuffisante pour cette action.");
  }

  return {
    crmId: crm.id,
    crmSlug: crm.slug,
    crmName: crm.name,
    role: access.role,
    category: access.category,
    permissions: effectivePermissions(access),
    isGlobalAdmin: ctx.user.isGlobalAdmin,
  };
}

export async function requireCrmAccessBySlug(
  ctx: AuthContext,
  crmSlug: string,
  permission?: Permission
): Promise<TenantContext> {
  const crm = await prisma.crm.findUnique({ where: { slug: crmSlug } });
  if (!crm || !crm.isActive) {
    throw new AuthError("CRM_ACCESS_DENIED", "Ce CRM est introuvable ou désactivé.");
  }
  return requireCrmAccess(ctx, crm.id, permission);
}

/**
 * Liste des CRM auxquels l'utilisateur a effectivement accès (pour le
 * sélecteur / l'accueil), avec la catégorie d'accès de chacun. Utile
 * notamment pour construire un lien d'entrée direct vers la bonne page
 * par catégorie (voir src/app/home/page.tsx) plutôt que de compter sur
 * une redirection déclenchée pendant le rendu de la page de destination :
 * Next.js ne suit pas toujours fidèlement un redirect() serveur lors
 * d'une navigation côté client (clic sur un <Link>), ce qui peut laisser
 * une page blanche — voir le layout /c/[crmSlug] pour le contrôle
 * équivalent côté serveur, qui lui reste la protection de référence.
 */
export async function listAccessibleCrms(ctx: AuthContext) {
  if (ctx.user.isGlobalAdmin) {
    const crms = await prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
    return crms.map((crm) => ({ ...crm, category: AccessCategory.COMMERCIAL as AccessCategory }));
  }
  const access = await prisma.userCrmAccess.findMany({
    where: { userId: ctx.user.id, crm: { isActive: true } },
    include: { crm: true },
    orderBy: { crm: { order: "asc" } },
  });
  return access.map((a) => ({ ...a.crm, category: a.category }));
}

/**
 * Bloque les pages réservées à la catégorie COMMERCIAL (tâches,
 * messagerie...). Le layout /c/[crmSlug] fait déjà ce contrôle, mais
 * Next.js ne réexécute pas un layout lors d'une navigation côté client vers
 * une autre page du même sous-arbre (clic sur un <Link>) : le layout seul
 * ne bloque donc que le premier accès (rechargement complet ou lien
 * externe), pas une navigation interne ultérieure. Chaque page réservée
 * doit donc refaire ce contrôle elle-même.
 *
 * `allowSecretaire` : certaines pages par ailleurs réservées à COMMERCIAL
 * (Tableau de bord, Activité) restent accessibles à la catégorie
 * SECRETAIRE — elle n'a de "total admin" que hors données commerciales,
 * voir prisma/schema.prisma (AccessCategory) et canManageOperations
 * ci-dessous. Par défaut SECRETAIRE est bloquée comme OUVRIER (ex. Tâches,
 * Messagerie).
 */
export function requireCommercial(tenant: TenantContext, options: { allowSecretaire?: boolean } = {}): void {
  if (tenant.isGlobalAdmin) return;
  const blocked = tenant.category === "OUVRIER" || (tenant.category === "SECRETAIRE" && !options.allowSecretaire);
  if (blocked) {
    redirect(`/c/${tenant.crmSlug}/planning`);
  }
}

/**
 * Contrôle d'accès pour les fonctions d'"administration opérationnelle"
 * d'un CRM (Planning, Coffre-fort, Ordre de mission) — historiquement
 * gardées par la permission commerciale MANAGE_SETTINGS, mais celle-ci
 * ouvre aussi /c/[crmSlug]/settings (Pipeline, TVA, modèles de devis :
 * données commerciales). La catégorie SECRETAIRE ne doit JAMAIS recevoir
 * MANAGE_SETTINGS (elle atteindrait Settings via URL directe malgré la
 * navigation masquée — voir le correctif de sécurité "OUVRIER layout gate
 * bypassed via soft navigation"), donc ce contournement se fait par
 * catégorie explicite, ici, et nulle part ailleurs.
 */
export function canManageOperations(tenant: TenantContext): boolean {
  return tenant.isGlobalAdmin || tenant.category === AccessCategory.SECRETAIRE || tenant.permissions.has(Permission.MANAGE_SETTINGS);
}

/** Comme requireCrmAccess, mais exige en plus canManageOperations (voir ci-dessus). */
export async function requireOperationsAccess(ctx: AuthContext, crmId: string): Promise<TenantContext> {
  const tenant = await requireCrmAccess(ctx, crmId);
  if (!canManageOperations(tenant)) {
    throw new AuthError("FORBIDDEN", "Permission insuffisante pour cette action.");
  }
  return tenant;
}

/**
 * Vérifie qu'une entité donnée (déjà chargée avec son crmId) appartient
 * bien au CRM du contexte courant. Filet de sécurité supplémentaire pour
 * les routes qui reçoivent un id de ressource en paramètre : le crmId de
 * l'URL ne suffit jamais, il faut aussi vérifier que la ressource pointée
 * appartient réellement à ce CRM.
 */
export function assertBelongsToCrm(entityCrmId: string, tenant: TenantContext, entityLabel = "Ressource"): void {
  if (entityCrmId !== tenant.crmId) {
    throw new AuthError("CRM_ACCESS_DENIED", `${entityLabel} introuvable dans ce CRM.`);
  }
}
