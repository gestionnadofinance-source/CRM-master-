import {
  LayoutDashboard,
  KanbanSquare,
  CalendarDays,
  CalendarPlus,
  Users,
  UserPlus,
  UserCog,
  FileText,
  CheckSquare,
  MessageSquare,
  History,
  Settings,
  CalendarRange,
  Lock,
  ClipboardList,
  ClipboardCheck,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { Permission } from "@prisma/client";

export interface NavItem {
  label: string;
  href: (crmSlug: string) => string;
  icon: LucideIcon;
  permission?: Permission;
  /**
   * true (par défaut) : onglet réservé à la catégorie d'accès COMMERCIAL.
   * false : visible pour toutes les catégories (COMMERCIAL, OUVRIER et
   * SECRETAIRE), ex. Planning et Coffre-fort. Un administrateur global voit
   * toujours tout, quelle que soit cette valeur — voir
   * src/components/crm-sidebar.tsx et l'application équivalente côté
   * serveur dans src/app/c/[crmSlug]/layout.tsx.
   */
  commercialOnly?: boolean;
  /**
   * true : onglet réservé aux chefs de chantier, c'est-à-dire les
   * utilisateurs affectés à au moins un chantier avec le rôle FOREMAN
   * (ChantierAssignment.role — géré par un administrateur dans Planning).
   * Un administrateur global, ou un accès de catégorie SECRETAIRE, voit
   * toujours tout. Voir amIForeman dans src/server/pointage/actions.ts et
   * son usage dans src/app/c/[crmSlug]/layout.tsx.
   */
  foremanOnly?: boolean;
  /**
   * true : malgré commercialOnly, cet onglet reste visible pour la
   * catégorie SECRETAIRE ("accès total admin" hors données commerciales —
   * voir prisma/schema.prisma AccessCategory), ex. Tableau de bord,
   * Activité, Comptabilité. Sans effet si commercialOnly est déjà false.
   * Ignoré si secretaireOnly est vrai. Si l'onglet porte aussi une
   * `permission` (ex. Comptabilité → MANAGE_SETTINGS, qu'une SECRETAIRE
   * n'a jamais — voir canManageOperations), cette permission est
   * contournée pour SECRETAIRE : c'est cette combinaison qui exprime "visible
   * pour les admins ET la secrétaire, jamais pour un simple commercial".
   */
  secretaireVisible?: boolean;
  /**
   * true : onglet réservé à la catégorie SECRETAIRE (et à l'administrateur
   * global) — jamais visible pour COMMERCIAL ni OUVRIER, ex. Utilisateurs.
   */
  secretaireOnly?: boolean;
}

export const CRM_NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: (s) => `/c/${s}/dashboard`, icon: LayoutDashboard, commercialOnly: true, secretaireVisible: true },
  { label: "Pipeline", href: (s) => `/c/${s}/pipeline`, icon: KanbanSquare, permission: Permission.MANAGE_PROSPECTS, commercialOnly: true },
  { label: "Agenda", href: (s) => `/c/${s}/agenda`, icon: CalendarDays, permission: Permission.MANAGE_APPOINTMENTS, commercialOnly: true },
  { label: "Prise de RDV", href: (s) => `/c/${s}/booking`, icon: CalendarPlus, permission: Permission.MANAGE_APPOINTMENTS, commercialOnly: true },
  { label: "Clients", href: (s) => `/c/${s}/clients`, icon: Users, permission: Permission.MANAGE_CLIENTS, commercialOnly: true },
  { label: "Prospects", href: (s) => `/c/${s}/prospects`, icon: UserPlus, permission: Permission.MANAGE_PROSPECTS, commercialOnly: true },
  { label: "Devis", href: (s) => `/c/${s}/quotes`, icon: FileText, permission: Permission.MANAGE_QUOTES, commercialOnly: true },
  { label: "Tâches", href: (s) => `/c/${s}/tasks`, icon: CheckSquare, commercialOnly: true },
  { label: "Messagerie", href: (s) => `/c/${s}/messages`, icon: MessageSquare, commercialOnly: true },
  { label: "Utilisateurs", href: (s) => `/c/${s}/users`, icon: UserCog, commercialOnly: true, secretaireOnly: true },
  { label: "Planning", href: (s) => `/c/${s}/planning`, icon: CalendarRange, commercialOnly: false },
  { label: "Pointage salariés", href: (s) => `/c/${s}/pointage-salaries`, icon: ClipboardList, commercialOnly: false, foremanOnly: true },
  { label: "Pointage client", href: (s) => `/c/${s}/pointage-client`, icon: ClipboardCheck, commercialOnly: false, foremanOnly: true },
  { label: "Coffre-fort", href: (s) => `/c/${s}/vault`, icon: Lock, commercialOnly: false },
  {
    label: "Comptabilité",
    href: (s) => `/c/${s}/comptabilite`,
    icon: Calculator,
    permission: Permission.MANAGE_SETTINGS,
    commercialOnly: true,
    secretaireVisible: true,
  },
  { label: "Activité", href: (s) => `/c/${s}/activity`, icon: History, commercialOnly: true, secretaireVisible: true },
  { label: "Paramètres CRM", href: (s) => `/c/${s}/settings`, icon: Settings, permission: Permission.MANAGE_SETTINGS, commercialOnly: true },
];
