import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { createAppointment } from "@/server/agenda/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, appointments] = await Promise.all([
    prisma.appointment.count(),
    prisma.appointment.findMany({
      orderBy: { startAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        title: true,
        client: { select: { company: true } },
        prospect: { select: { company: true } },
        owner: { select: { firstName: true, lastName: true } },
        startAt: true,
        endAt: true,
        location: true,
        status: true,
        reportSummary: true,
        reportNextStep: true,
        createdAt: true,
      },
    }),
  ]);

  const data = appointments.map(({ client, prospect, owner, ...a }) => ({
    ...a,
    entityName: client?.company ?? prospect?.company ?? null,
    ownerName: `${owner.firstName} ${owner.lastName}`,
  }));

  return NextResponse.json({ data, page, perPage, total });
}

export async function POST(request: NextRequest) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await createAppointment(String(body.crmId), jsonToFormData(body), access.actor);
    return actionResultResponse(result, 201);
  });
}
