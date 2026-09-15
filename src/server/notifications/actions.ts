"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess } from "@/server/tenant";

export async function listRecentNotifications(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  return prisma.notification.findMany({
    where: { crmId: tenant.crmId, userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { actor: { select: { firstName: true, lastName: true, color: true } } },
  });
}

export async function countUnreadNotifications(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  return prisma.notification.count({
    where: { crmId: tenant.crmId, userId: ctx.user.id, readAt: null },
  });
}

export async function markNotificationRead(crmId: string, notificationId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await prisma.notification.updateMany({
    where: { id: notificationId, crmId: tenant.crmId, userId: ctx.user.id },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(crmId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccess(ctx, crmId);
  await prisma.notification.updateMany({
    where: { crmId: tenant.crmId, userId: ctx.user.id, readAt: null },
    data: { readAt: new Date() },
  });
}
