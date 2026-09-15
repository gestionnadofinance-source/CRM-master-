import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { saveQuote } from "@/server/quotes/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, quotes] = await Promise.all([
    prisma.quote.count(),
    prisma.quote.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        number: true,
        object: true,
        client: { select: { company: true } },
        prospect: { select: { company: true } },
        issueDate: true,
        validUntil: true,
        status: true,
        totalHt: true,
        totalVat: true,
        totalTtc: true,
        sentAt: true,
        acceptedAt: true,
        refusedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const data = quotes.map(({ client, prospect, totalHt, totalVat, totalTtc, ...q }) => ({
    ...q,
    entityName: client?.company ?? prospect?.company ?? null,
    totalHt: Number(totalHt),
    totalVat: Number(totalVat),
    totalTtc: Number(totalTtc),
  }));

  return NextResponse.json({ data, page, perPage, total });
}

export async function POST(request: NextRequest) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });

    const result = await saveQuote(String(body.crmId), null, body, access.actor);
    return actionResultResponse(result, 201);
  });
}
