import { NextRequest, NextResponse } from "next/server";
import { requireWriteAccess } from "@/server/public-api/auth";
import { actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { saveQuote, deleteQuote } from "@/server/quotes/actions";

/**
 * Édition complète d'un devis brouillon (lignes, objet, dates...) — voir
 * `saveQuote`. Pour les transitions de statut (envoyé, accepté...), voir
 * `POST .../quotes/[id]/status`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await saveQuote(String(body.crmId), id, body, access.actor);
    return actionResultResponse(result);
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const crmId = new URL(request.url).searchParams.get("crmId");
    if (!crmId) return NextResponse.json({ error: "Le paramètre crmId est obligatoire." }, { status: 400 });

    const result = await deleteQuote(crmId, id, access.actor);
    return actionResultResponse(result);
  });
}
