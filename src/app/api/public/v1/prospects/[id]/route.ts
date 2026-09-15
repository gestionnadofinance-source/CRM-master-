import { NextRequest, NextResponse } from "next/server";
import { requireWriteAccess } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { updateProspect, deleteProspect } from "@/server/prospects/actions";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await updateProspect(String(body.crmId), id, jsonToFormData(body), access.actor);
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

    const result = await deleteProspect(crmId, id, access.actor);
    return actionResultResponse(result);
  });
}
