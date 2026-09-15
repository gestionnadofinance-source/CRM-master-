import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { createChantier } from "@/server/planning/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, chantiers] = await Promise.all([
    prisma.chantier.count(),
    prisma.chantier.findMany({
      orderBy: { startDate: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        name: true,
        description: true,
        address: true,
        startDate: true,
        endDate: true,
        color: true,
        status: true,
        createdBy: { select: { firstName: true, lastName: true } },
        createdAt: true,
        updatedAt: true,
        assignments: {
          select: {
            user: { select: { firstName: true, lastName: true } },
            startDate: true,
            endDate: true,
            note: true,
          },
        },
      },
    }),
  ]);

  const data = chantiers.map(({ createdBy, assignments, ...c }) => ({
    ...c,
    createdByName: `${createdBy.firstName} ${createdBy.lastName}`,
    assignments: assignments.map(({ user, ...a }) => ({
      ...a,
      employeeName: `${user.firstName} ${user.lastName}`,
    })),
  }));

  return NextResponse.json({ data, page, perPage, total });
}

export async function POST(request: NextRequest) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await createChantier(String(body.crmId), jsonToFormData(body), access.actor);
    return actionResultResponse(result, 201);
  });
}
