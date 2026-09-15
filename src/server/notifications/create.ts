import "server-only";
import { prisma } from "@/lib/prisma";
import { publishToCrm, publishToUser } from "@/lib/realtime";
import { NotificationType } from "@prisma/client";

export interface NotifyCrmInput {
  crmId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  /** Utilisateurs à ne pas notifier (typiquement l'auteur de l'action). */
  excludeUserIds?: string[];
}

/**
 * Notifie tous les utilisateurs ayant accès au CRM concerné (hors exclusions).
 * Les notifications restent strictement isolées par CRM : seuls les
 * utilisateurs ayant un UserCrmAccess sur ce crmId (ou étant admin global)
 * reçoivent la notification.
 */
export async function notifyCrm(input: NotifyCrmInput): Promise<void> {
  const exclude = new Set(input.excludeUserIds ?? []);

  const [access, globalAdmins] = await Promise.all([
    prisma.userCrmAccess.findMany({ where: { crmId: input.crmId }, select: { userId: true } }),
    prisma.user.findMany({ where: { isGlobalAdmin: true, status: "ACTIVE" }, select: { id: true } }),
  ]);

  const recipientIds = new Set<string>();
  for (const a of access) recipientIds.add(a.userId);
  for (const a of globalAdmins) recipientIds.add(a.id);
  for (const id of exclude) recipientIds.delete(id);

  if (recipientIds.size === 0) return;

  await prisma.notification.createMany({
    data: Array.from(recipientIds).map((userId) => ({
      crmId: input.crmId,
      userId,
      actorId: input.actorId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });

  await publishToCrm(input.crmId, "notification.created", {
    type: input.type,
    title: input.title,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  for (const userId of recipientIds) {
    await publishToUser(userId, "notification.created", { type: input.type, title: input.title });
  }
}
