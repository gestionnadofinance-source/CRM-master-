import "server-only";
import { notFound, redirect } from "next/navigation";
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

// Un administrateur global n'a pas de ligne UserCrmAccess : on lui fabrique
// un accès synthétique. SECRETAIRE est la catégorie la plus large depuis le
// retrait du commercial ; de toute façon isGlobalAdmin court-circuite tous
// les contrôles de catégorie.
const GLOBAL_ADMIN_ACCESS: AccessSummary = {
  role: CrmRole.MANAGER,
  category: AccessCategory.SECRETAIRE,
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
  return authorizeCrm(ctx, crm, permission);
}

/**
 * Cœur de la vérification, à partir d'un CRM déjà chargé.
 *
 * Existe pour que requireCrmAccessBySlug n'ait pas à relire le même
 * enregistrement une seconde fois : il le chargeait par slug, puis déléguait à
 * requireCrmAccess qui le rechargeait aussitôt par id. Un aller-retour inutile
 * vers la base sur chaque page d'un CRM — négligeable en local, sensible dès
 * que la base est distante de l'exécution.
 *
 * Les contrôles eux-mêmes sont inchangés et restent groupés ici, en un seul
 * endroit : CRM existant et actif, accès de l'utilisateur, permission requise.
 */
async function authorizeCrm(
  ctx: AuthContext,
  crm: { id: string; slug: string; name: string; isActive: boolean } | null,
  permission?: Permission
): Promise<TenantContext> {
  if (!crm || !crm.isActive) {
    throw new AuthError("CRM_ACCESS_DENIED", "Ce CRM est introuvable ou désactivé.");
  }
  const crmId = crm.id;

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
  return authorizeCrm(ctx, crm, permission);
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
    return crms.map((crm) => ({ ...crm, category: AccessCategory.SECRETAIRE as AccessCategory }));
  }
  const access = await prisma.userCrmAccess.findMany({
    where: { userId: ctx.user.id, crm: { isActive: true } },
    include: { crm: true },
    orderBy: { crm: { order: "asc" } },
  });
  return access.map((a) => ({ ...a.crm, category: a.category }));
}

/**
 * Bloque les pages d'exploitation transverse (Comptabilité, Activité,
 * Utilisateurs) pour un ouvrier ou un chef de chantier. Le layout
 * /c/[crmSlug] fait déjà ce contrôle, mais Next.js ne réexécute pas un
 * layout lors d'une navigation côté client vers une autre page du même
 * sous-arbre (clic sur un <Link>) : le layout seul ne bloque donc que le
 * premier accès (rechargement complet ou lien externe), pas une navigation
 * interne ultérieure. Chaque page réservée doit refaire ce contrôle.
 */
export function requireOperationsCategory(tenant: TenantContext): void {
  if (tenant.isGlobalAdmin) return;
  if (tenant.category !== AccessCategory.SECRETAIRE) {
    redirect(`/c/${tenant.crmSlug}/planning`);
  }
}

/**
 * Contrôle d'accès pour les fonctions d'"administration opérationnelle"
 * d'un CRM (Planning, Coffre-fort, Ordre de mission) — historiquement
 * gardées par la permission commerciale MANAGE_SETTINGS, mais celle-ci
 * ouvre aussi /c/[crmSlug]/settings. La catégorie SECRETAIRE ne doit JAMAIS recevoir
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

/**
 * Variantes des gardes d'accès destinées au rendu d'une PAGE.
 *
 * Next.js peut rendre layout.tsx et page.tsx en parallèle : le
 * `catch (AuthError) → notFound()` du layout /c/[crmSlug] ne protège donc pas
 * une AuthError levée par la page elle-même. Celle-ci remonte alors en HTTP
 * 500 — une page d'erreur serveur là où l'utilisateur devrait simplement ne
 * rien trouver, et un signal exploitable : un 500 confirme que la ressource
 * existe (dans un autre CRM), là où un 404 est indistinguable d'un
 * identifiant inventé.
 *
 * Les pages /admin/* réglaient déjà le problème par une garde explicite
 * (`if (!ctx.user.isGlobalAdmin) notFound()`), les pages de CRM non. Ces deux
 * fonctions sont l'équivalent pour elles. Les server actions continuent
 * d'utiliser les gardes brutes : une action doit propager l'AuthError, pas la
 * transformer en 404.
 */
export async function requireCrmAccessBySlugOrNotFound(
  ctx: AuthContext,
  crmSlug: string,
  permission?: Permission
): Promise<TenantContext> {
  try {
    return await requireCrmAccessBySlug(ctx, crmSlug, permission);
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }
}

/** Voir requireCrmAccessBySlugOrNotFound : même traduction, pour la vérification d'appartenance. */
export function assertBelongsToCrmOrNotFound(
  entityCrmId: string,
  tenant: TenantContext,
  entityLabel = "Ressource"
): void {
  try {
    assertBelongsToCrm(entityCrmId, tenant, entityLabel);
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }
}
