import "server-only";
import Pusher from "pusher";
import { getServerEnv, isRealtimeConfigured } from "@/lib/env";

let client: Pusher | null = null;

function getPusher(): Pusher | null {
  if (!isRealtimeConfigured()) return null;
  if (client) return client;
  const env = getServerEnv();
  client = new Pusher({
    appId: env.PUSHER_APP_ID!,
    key: env.PUSHER_KEY!,
    secret: env.PUSHER_SECRET!,
    cluster: env.PUSHER_CLUSTER!,
    useTLS: true,
  });
  return client;
}

/**
 * Tous les canaux temps réel sont préfixés par le CRM concerné : un
 * événement ne peut jamais fuiter vers un autre CRM, y compris côté
 * transport temps réel (pas seulement côté requête HTTP initiale).
 */
export function crmChannel(crmId: string): string {
  return `private-crm-${crmId}`;
}

export function userChannel(userId: string): string {
  return `private-user-${userId}`;
}

export type RealtimeEvent =
  | "client.upserted"
  | "client.deleted"
  | "prospect.upserted"
  | "prospect.deleted"
  | "opportunity.upserted"
  | "opportunity.moved"
  | "appointment.upserted"
  | "appointment.deleted"
  | "task.upserted"
  | "quote.upserted"
  | "message.created"
  | "notification.created"
  | "presence.updated";

export async function publishToCrm(crmId: string, event: RealtimeEvent, payload: unknown): Promise<void> {
  const pusher = getPusher();
  if (!pusher) return; // Realtime non configuré : l'app reste fonctionnelle (polling côté client).
  await pusher.trigger(crmChannel(crmId), event, payload);
}

export async function publishToUser(userId: string, event: RealtimeEvent, payload: unknown): Promise<void> {
  const pusher = getPusher();
  if (!pusher) return;
  await pusher.trigger(userChannel(userId), event, payload);
}

export function authorizeChannel(socketId: string, channel: string, userId: string) {
  const pusher = getPusher();
  if (!pusher) return null;
  return pusher.authorizeChannel(socketId, channel, {
    user_id: userId,
  });
}
