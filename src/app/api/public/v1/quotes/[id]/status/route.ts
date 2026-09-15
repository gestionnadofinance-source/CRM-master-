import { NextRequest, NextResponse } from "next/server";
import { requireWriteAccess } from "@/server/public-api/auth";
import { actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { setQuoteStatus } from "@/server/quotes/actions";
import { QuoteStatus } from "@prisma/client";

/**
 * `POST { crmId, status }` — transition de statut d'un devis
 * (FOLLOWED_UP/ACCEPTED/REFUSED/EXPIRED, selon les transitions autorisées
 * depuis le statut courant). Le passage à SENT n'est volontairement pas
 * exposé ici : il déclenche l'envoi d'un email avec PDF joint côté
 * application, non répliqué dans cette API.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });
    if (!body?.status) return NextResponse.json({ error: "status est obligatoire." }, { status: 400 });

    const result = await setQuoteStatus(String(body.crmId), id, body.status as QuoteStatus, access.actor);
    return actionResultResponse(result);
  });
}
