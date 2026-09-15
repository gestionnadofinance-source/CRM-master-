import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { createClient } from "@/server/clients/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, clients] = await Promise.all([
    prisma.client.count(),
    prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        company: true,
        sector: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
        activity: true,
        siret: true,
        status: true,
        notes: true,
        owner: { select: { firstName: true, lastName: true } },
        commercialValue: true,
        revenue: true,
        lastContactAt: true,
        nextContactAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const data = clients.map(({ owner, commercialValue, revenue, ...c }) => ({
    ...c,
    commercialValue: commercialValue !== null ? Number(commercialValue) : null,
    revenue: revenue !== null ? Number(revenue) : null,
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

    const result = await createClient(String(body.crmId), jsonToFormData(body), access.actor);
    return actionResultResponse(result, 201);
  });
}
