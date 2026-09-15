import "server-only";
import { prisma } from "@/lib/prisma";
import { publishToCrm } from "@/lib/realtime";

export interface LogActivityInput {
  crmId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  clientId?: string;
  prospectId?: string;
  quoteId?: string;
  appointmentId?: string;
}

/** Journalise une action métier. Ne doit jamais faire échouer l'opération appelante. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        crmId: input.crmId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        oldValue: input.oldValue === undefined ? undefined : (input.oldValue as object),
        newValue: input.newValue === undefined ? undefined : (input.newValue as object),
        clientId: input.clientId,
        prospectId: input.prospectId,
        quoteId: input.quoteId,
        appointmentId: input.appointmentId,
      },
    });
    if (input.crmId) {
      await publishToCrm(input.crmId, "notification.created", {
        kind: "activity",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    }
  } catch (err) {
    console.error("[activity] échec de journalisation", err);
  }
}
