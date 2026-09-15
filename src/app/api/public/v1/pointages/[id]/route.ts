import { NextRequest, NextResponse } from "next/server";
import { requireWriteAccess } from "@/server/public-api/auth";
import { actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { deletePointageEntry } from "@/server/pointage/actions";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const crmId = new URL(request.url).searchParams.get("crmId");
    if (!crmId) return NextResponse.json({ error: "Le paramètre crmId est obligatoire." }, { status: 400 });

    const result = await deletePointageEntry(crmId, id, access.actor);
    return actionResultResponse(result);
  });
}
