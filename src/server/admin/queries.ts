import "server-only";
import { prisma } from "@/lib/prisma";
import { mondayOf } from "@/server/pointage/calc";

export interface SpaceDashboardRow {
  id: string;
  slug: string;
  name: string;
  color: string;
  isActive: boolean;
  activeUsers: number;
  chantiersEnCours: number;
  chantiersTotal: number;
  pointagesSemaine: number;
  pointagesTotal: number;
  salariesAffectes: number;
  vaultDocuments: number;
  derniersPointages: {
    id: string;
    employeeName: string;
    chantierName: string;
    weekStart: Date;
    updatedAt: Date;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    createdAt: Date;
    userName: string | null;
  }[];
}

export interface AdminDashboard {
  weekStart: Date;
  totals: {
    chantiersEnCours: number;
    pointagesSemaine: number;
    salariesAffectes: number;
    vaultDocuments: number;
  };
  spaces: SpaceDashboardRow[];
}

/**
 * Résumé d'exploitation pour le tableau de bord d'administration.
 *
 * Chaque espace est interrogé indépendamment — aucun compteur n'est fusionné
 * entre espaces au niveau de la carte. Les totaux du bandeau, eux, agrègent
 * volontairement : trois d'entre eux s'additionnent sans risque de double
 * comptage (chantiers, pointages, documents appartiennent à un seul espace),
 * mais PAS le nombre de salariés — une même personne peut être affectée dans
 * les deux entités. Il est donc compté distinctement, par une requête à part,
 * plutôt qu'en sommant les cartes.
 *
 * La semaine courante suit `mondayOf`, la convention déjà utilisée par la
 * saisie de pointage (src/server/pointage/calc.ts) : sans cela le bandeau et
 * les feuilles réelles ne parleraient pas de la même semaine.
 */
export async function getAdminDashboard(): Promise<AdminDashboard> {
  const weekStart = mondayOf(new Date());
  const crms = await prisma.crm.findMany({ orderBy: { order: "asc" } });

  const spaces = await Promise.all(
    crms.map(async (crm): Promise<SpaceDashboardRow> => {
      const [
        activeUsers,
        chantiersEnCours,
        chantiersTotal,
        pointagesSemaine,
        pointagesTotal,
        affectations,
        vaultDocuments,
        derniersPointages,
        recentActivity,
      ] = await Promise.all([
        prisma.userCrmAccess.count({ where: { crmId: crm.id, user: { status: "ACTIVE" } } }),
        prisma.chantier.count({ where: { crmId: crm.id, status: "IN_PROGRESS" } }),
        prisma.chantier.count({ where: { crmId: crm.id } }),
        prisma.pointage.count({ where: { crmId: crm.id, weekStart } }),
        prisma.pointage.count({ where: { crmId: crm.id } }),
        prisma.chantierAssignment.findMany({
          where: { chantier: { crmId: crm.id } },
          distinct: ["userId"],
          select: { userId: true },
        }),
        prisma.vaultDocument.count({ where: { crmId: crm.id } }),
        prisma.pointage.findMany({
          where: { crmId: crm.id },
          orderBy: { updatedAt: "desc" },
          take: 4,
          select: {
            id: true,
            weekStart: true,
            updatedAt: true,
            employee: { select: { firstName: true, lastName: true } },
            chantier: { select: { name: true } },
          },
        }),
        prisma.activityLog.findMany({
          where: { crmId: crm.id },
          orderBy: { createdAt: "desc" },
          take: 4,
          select: {
            id: true,
            action: true,
            entityType: true,
            createdAt: true,
            user: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);

      return {
        id: crm.id,
        slug: crm.slug,
        name: crm.name,
        color: crm.color,
        isActive: crm.isActive,
        activeUsers,
        chantiersEnCours,
        chantiersTotal,
        pointagesSemaine,
        pointagesTotal,
        salariesAffectes: affectations.length,
        vaultDocuments,
        derniersPointages: derniersPointages.map((p) => ({
          id: p.id,
          employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
          chantierName: p.chantier.name,
          weekStart: p.weekStart,
          updatedAt: p.updatedAt,
        })),
        recentActivity: recentActivity.map((a) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          createdAt: a.createdAt,
          userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        })),
      };
    })
  );

  // Salariés affectés, toutes entités confondues : compté distinctement
  // (voir le commentaire ci-dessus), pas en sommant les cartes.
  const salaries = await prisma.chantierAssignment.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });

  const sum = (pick: (s: SpaceDashboardRow) => number) => spaces.reduce((t, s) => t + pick(s), 0);

  return {
    weekStart,
    totals: {
      chantiersEnCours: sum((s) => s.chantiersEnCours),
      pointagesSemaine: sum((s) => s.pointagesSemaine),
      salariesAffectes: salaries.length,
      vaultDocuments: sum((s) => s.vaultDocuments),
    },
    spaces,
  };
}
export interface AdminUserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isGlobalAdmin: boolean;
  status: "ACTIVE" | "DISABLED";
  lastSeenAt: Date | null;
  access: { crmId: string; crmName: string; crmSlug: string; role: string; category: string }[];
}

export async function listAllUsers(): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ status: "asc" }, { lastName: "asc" }],
    include: {
      crmAccess: { include: { crm: { select: { id: true, name: true, slug: true } } } },
      sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    isGlobalAdmin: u.isGlobalAdmin,
    status: u.status,
    lastSeenAt: u.sessions[0]?.lastSeenAt ?? null,
    access: u.crmAccess.map((a) => ({
      crmId: a.crmId,
      crmName: a.crm.name,
      crmSlug: a.crm.slug,
      role: a.role,
      category: a.category,
    })),
  }));
}

export async function getUserForEdit(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { crmAccess: true },
  });
}

export interface ActivityLogFilters {
  crmId?: string;
  userId?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface ActivityLogPage {
  rows: {
    id: string;
    crmName: string | null;
    userName: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: Date;
    oldValue: unknown;
    newValue: unknown;
  }[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Requête de journal d'activité partagée entre la vue globale (/admin/activity,
 * réservée aux administrateurs) et la vue par CRM (/c/[crmSlug]/activity, où
 * l'appelant DOIT fixer filters.crmId pour ne jamais exposer d'autres CRM).
 */
export async function queryActivityLog(filters: ActivityLogFilters): Promise<ActivityLogPage> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 25;

  const where: Record<string, unknown> = {};
  if (filters.crmId) where.crmId = filters.crmId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        crm: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      crmName: r.crm?.name ?? null,
      userName: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      createdAt: r.createdAt,
      oldValue: r.oldValue,
      newValue: r.newValue,
    })),
    total,
    page,
    pageSize,
  };
}
