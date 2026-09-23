import "server-only";
import { Permission, CrmRole, AccessCategory } from "@prisma/client";

export { Permission, CrmRole, AccessCategory };

/**
 * Permissions accordées par défaut selon le rôle CRM, en l'absence de
 * dérogation explicite sur UserCrmAccess.permissions. Un administrateur
 * global (User.isGlobalAdmin) contourne ce système : il a toutes les
 * permissions sur tous les CRM.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<CrmRole, Permission[]> = {
  MANAGER: [
    Permission.VIEW,
    Permission.CREATE,
    Permission.EDIT,
    Permission.DELETE,
    Permission.EXPORT,
    Permission.MANAGE_SETTINGS,
    Permission.MANAGE_USERS,
  ],
  USER: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
};

export interface AccessLike {
  role: CrmRole;
  category: AccessCategory;
  permissions: Permission[];
}

/**
 * Permissions effectives = union du défaut du rôle et des dérogations
 * explicites stockées sur l'accès. `permissions` ne retire jamais un droit
 * du rôle, il ne fait qu'en ajouter (ex : un USER auquel on donne EXPORT).
 * Pour retirer un droit, il faut changer le rôle.
 *
 * Un accès de catégorie OUVRIER n'hérite d'AUCUNE permission par défaut,
 * quel que soit son rôle : il n'atteint Planning, Coffre-fort et Pointage
 * que par des contrôles de catégorie dédiés (voir canManageOperations et
 * requireOperationsCategory dans src/server/tenant.ts). SECRETAIRE passe
 * par le même mécanisme pour l'exploitation transverse, mais ne reçoit
 * jamais MANAGE_SETTINGS, qui ouvrirait les Paramètres.
 */
export function effectivePermissions(access: AccessLike): Set<Permission> {
  const roleDefaults =
    access.category === "OUVRIER" || access.category === "SECRETAIRE" ? [] : ROLE_DEFAULT_PERMISSIONS[access.role];
  return new Set([...roleDefaults, ...access.permissions]);
}

export function hasPermission(access: AccessLike, permission: Permission): boolean {
  return effectivePermissions(access).has(permission);
}
