import "server-only";
import { prisma } from "@/lib/prisma";

export interface CrmDashboardRow {
  id: string;
  slug: string;
  name: string;
  color: string;
  isActive: boolean;
  activeUsers: number;
  chantiers: number;
  chantiersEnCours: number;
  pointages: number;
  vaultDocuments: number;
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    createdAt: Date;
    userName: string | null;
  }[];
}

/**
 * Indicateurs agrégés par espace pour le tableau de bord d'administration.
 * Chaque espace est interrogé indépendamment : les compteurs métier
 * (chantiers, pointages, documents) ne sont jamais fusionnés entre espaces,
 * seul le total d'utilisateurs actifs de la société (portée propre à
 * l'administration) peut être vu globalement.
 */
export async function getCrmDashboardRows(): Promise<CrmDashboardRow[]> {
  const crms = await prisma.crm.findMany({ orderBy: { order: "asc" } });

  return Promise.all(
    crms.map(async (crm) => {
      const [activeUsers, chantiers, chantiersEnCours, pointages, vaultDocuments, recentActivity] = await Promise.all([
        prisma.userCrmAccess.count({ where: { crmId: crm.id, user: { status: "ACTIVE" } } }),
        prisma.chantier.count({ where: { crmId: crm.id } }),
        prisma.chantier.count({ where: { crmId: crm.id, status: "IN_PROGRESS" } }),
        prisma.pointage.count({ where: { crmId: crm.id } }),
        prisma.vaultDocument.count({ where: { crmId: crm.id } }),
        prisma.activityLog.findMany({
          where: { crmId: crm.id },
          orderBy: { createdAt: "desc" },
          take: 6,
          include: { user: { select: { firstName: true, lastName: true } } },
        }),
      ]);

      return {
        id: crm.id,
        slug: crm.slug,
        name: crm.name,
        color: crm.color,
        isActive: crm.isActive,
        activeUsers,
        chantiers,
        chantiersEnCours,
        pointages,
        vaultDocuments,
        recentActivity: recentActivity.map((a: (typeof recentActivity)[number]) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          createdAt: a.createdAt,
          userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        })),
      };
    })
  );
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
