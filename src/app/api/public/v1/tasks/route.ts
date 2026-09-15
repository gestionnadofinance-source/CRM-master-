import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { createTask } from "@/server/tasks/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, tasks] = await Promise.all([
    prisma.task.count(),
    prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        title: true,
        description: true,
        assignee: { select: { firstName: true, lastName: true } },
        client: { select: { company: true } },
        prospect: { select: { company: true } },
        priority: true,
        status: true,
        dueAt: true,
        isAutomated: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  const data = tasks.map(({ assignee, client, prospect, ...t }) => ({
    ...t,
    assigneeName: `${assignee.firstName} ${assignee.lastName}`,
    entityName: client?.company ?? prospect?.company ?? null,
  }));

  return NextResponse.json({ data, page, perPage, total });
}

export async function POST(request: NextRequest) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await createTask(String(body.crmId), jsonToFormData(body), access.actor);
    return actionResultResponse(result, 201);
  });
}
