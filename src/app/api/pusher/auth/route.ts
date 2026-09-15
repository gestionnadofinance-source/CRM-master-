import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { requireCrmAccess } from "@/server/tenant";
import { authorizeChannel, userChannel } from "@/lib/realtime";
import { AuthError } from "@/server/auth/session";

/**
 * Autorisation des canaux privés Pusher. Un canal `private-crm-{id}` n'est
 * autorisé que si l'utilisateur authentifié a réellement accès à ce CRM —
 * même vérification que pour toute route de données (voir requireCrmAccess).
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const form = await request.formData();
  const socketId = String(form.get("socket_id") ?? "");
  const channel = String(form.get("channel_name") ?? "");

  if (channel === userChannel(ctx.user.id)) {
    const auth = authorizeChannel(socketId, channel, ctx.user.id);
    return auth ? NextResponse.json(auth) : NextResponse.json({ error: "REALTIME_DISABLED" }, { status: 503 });
  }

  const crmMatch = channel.match(/^private-crm-(.+)$/);
  const crmIdFromChannel = crmMatch?.[1];
  if (crmIdFromChannel) {
    try {
      await requireCrmAccess(ctx, crmIdFromChannel);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.code }, { status: 403 });
      }
      throw err;
    }
    const auth = authorizeChannel(socketId, channel, ctx.user.id);
    return auth ? NextResponse.json(auth) : NextResponse.json({ error: "REALTIME_DISABLED" }, { status: 503 });
  }

  return NextResponse.json({ error: "UNKNOWN_CHANNEL" }, { status: 400 });
}
