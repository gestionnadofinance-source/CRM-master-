import "server-only";
import { Permission, CrmRole, AccessCategory } from "@prisma/client";

export { Permission, CrmRole, AccessCategory };

export interface AccessLike {
  role: CrmRole;
  category: AccessCategory;
  permissions: Permission[];
}

/**
 * Permissions effectives d'un accès.
 *
 * Depuis le retrait du volet commercial, il ne reste que deux catégories,
 * OUVRIER et SECRETAIRE, et aucune des deux n'hérite de permission par
 * défaut : leur accès passe par des contrôles de catégorie explicites
 * (`canManageOperations`, `requireOperationsCategory` dans
 * src/server/tenant.ts), jamais par une Permission. Les permissions ne
 * proviennent donc plus que des dérogations posées à la main sur
 * `UserCrmAccess.permissions`.
 *
 * Conséquence assumée : `UserCrmAccess.role` (Responsable / Utilisateur)
 * n'accorde plus rien par lui-même. Le champ est conservé — il reste
 * affiché et sert à distinguer les accès — mais le jeu de permissions par
 * défaut par rôle qui existait ici n'avait plus aucun chemin d'exécution
 * une fois la catégorie COMMERCIAL supprimée : le garder aurait laissé
 * croire à une protection inexistante.
 *
 * Un administrateur global (`User.isGlobalAdmin`) ne passe pas par ici :
 * il reçoit toutes les permissions, voir GLOBAL_ADMIN_ACCESS.
 */
export function effectivePermissions(access: AccessLike): Set<Permission> {
  return new Set(access.permissions);
}

export function hasPermission(access: AccessLike, permission: Permission): boolean {
  return effectivePermissions(access).has(permission);
}
