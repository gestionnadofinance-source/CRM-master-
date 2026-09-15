import { NextRequest, NextResponse } from "next/server";
import { requireWriteAccess } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { updateTask, setTaskStatus, deleteTask } from "@/server/tasks/actions";
import { TaskStatus } from "@prisma/client";

/**
 * `PATCH { crmId, status }` seul (sans autre champ) bascule uniquement le
 * statut (ex. marquer une tâche terminée) sans exiger de resoumettre le
 * formulaire complet — même raccourci que `setTaskStatus` côté application.
 * Tout autre corps déclenche une mise à jour complète via `updateTask`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const otherKeys = Object.keys(body).filter((k) => k !== "crmId" && k !== "status");
    if (otherKeys.length === 0 && typeof body.status === "string") {
      const result = await setTaskStatus(String(body.crmId), id, body.status as TaskStatus, access.actor);
      return actionResultResponse(result);
    }

    const result = await updateTask(String(body.crmId), id, jsonToFormData(body), access.actor);
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

    const result = await deleteTask(crmId, id, access.actor);
    return actionResultResponse(result);
  });
}
