import {
  UserCog,
  History,
  Settings,
  CalendarRange,
  Lock,
  ClipboardList,
  ClipboardCheck,
  Calculator,
  type LucideIcon,
} from "lucide-react";

/**
 * Publics de la navigation, dérivés de AccessCategory :
 *   ADMIN      — administrateur global (User.isGlobalAdmin), voit tout ;
 *   SECRETAIRE — accès transverse à l'exploitation ;
 *   OUVRIER    — ouvrier et chef de chantier.
 */
export type NavAudience = "ADMIN" | "SECRETAIRE" | "OUVRIER";

export interface NavItem {
  label: string;
  href: (crmSlug: string) => string;
  icon: LucideIcon;
  /** Publics qui voient l'onglet. */
  visibleTo: NavAudience[];
  /**
   * true : onglet réservé aux chefs de chantier, c'est-à-dire aux
   * utilisateurs affectés à au moins un chantier avec le rôle FOREMAN
   * (ChantierAssignment.role — géré dans Planning). Sans effet pour
   * l'administration et la secrétaire, qui voient toujours l'onglet. Voir
   * amIForeman dans src/server/pointage/actions.ts.
   */
  foremanOnly?: boolean;
}

/**
 * La navigation ne protège rien par elle-même : le contrôle de référence
 * est côté serveur, dans src/app/c/[crmSlug]/layout.tsx et dans chaque
 * page. Cette liste ne fait que masquer ce qui serait de toute façon
 * refusé.
 */
export const CRM_NAV_ITEMS: NavItem[] = [
  { label: "Planning", href: (s) => `/c/${s}/planning`, icon: CalendarRange, visibleTo: ["ADMIN", "SECRETAIRE", "OUVRIER"] },
  { label: "Pointage salariés", href: (s) => `/c/${s}/pointage-salaries`, icon: ClipboardList, visibleTo: ["ADMIN", "SECRETAIRE", "OUVRIER"], foremanOnly: true },
  { label: "Pointage client", href: (s) => `/c/${s}/pointage-client`, icon: ClipboardCheck, visibleTo: ["ADMIN", "SECRETAIRE", "OUVRIER"], foremanOnly: true },
  { label: "Coffre-fort", href: (s) => `/c/${s}/vault`, icon: Lock, visibleTo: ["ADMIN", "SECRETAIRE", "OUVRIER"] },
  { label: "Comptabilité", href: (s) => `/c/${s}/comptabilite`, icon: Calculator, visibleTo: ["ADMIN", "SECRETAIRE"] },
  { label: "Utilisateurs", href: (s) => `/c/${s}/users`, icon: UserCog, visibleTo: ["ADMIN", "SECRETAIRE"] },
  { label: "Activité", href: (s) => `/c/${s}/activity`, icon: History, visibleTo: ["ADMIN", "SECRETAIRE"] },
  { label: "Paramètres", href: (s) => `/c/${s}/settings`, icon: Settings, visibleTo: ["ADMIN"] },
];
