import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireWriteAccess, unauthorizedResponse, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { upsertPointageEntry } from "@/server/pointage/actions";

export async function GET(request: NextRequest) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { skip, take, page, perPage } = readPagination(request);

  const [total, pointages] = await Promise.all([
    prisma.pointage.count(),
    prisma.pointage.findMany({
      orderBy: { weekStart: "desc" },
      skip,
      take,
      select: {
        id: true,
        crmId: true,
        chantier: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
        foreman: { select: { firstName: true, lastName: true } },
        weekStart: true,
        days: true,
        comments: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const data = pointages.map(({ chantier, employee, foreman, ...p }) => ({
    ...p,
    chantierName: chantier.name,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    foremanName: `${foreman.firstName} ${foreman.lastName}`,
  }));

  return NextResponse.json({ data, page, perPage, total });
}

/**
 * Crée ou met à jour (upsert par salarié + semaine, comme côté
 * application) une fiche de pointage. `days` doit être un tableau de 7
 * jours `{ normal, matin, apresMidi, nuit }` — ré-encodé en JSON avant
 * réutilisation de `upsertPointageEntry`, qui attend cette même
 * représentation côté formulaire.
 */
export async function POST(request: NextRequest) {
  const access = await requireWriteAccess(request);
  if (!access.ok) return access.response;

  return withWriteErrorHandling(async () => {
    const body = await request.json();
    if (!body?.crmId) return NextResponse.json({ error: "crmId est obligatoire." }, { status: 400 });
    if (!body?.chantierId) return NextResponse.json({ error: "chantierId est obligatoire." }, { status: 400 });

    const formBody = { ...body, days: JSON.stringify(body.days ?? []) };
    const result = await upsertPointageEntry(String(body.crmId), String(body.chantierId), jsonToFormData(formBody), access.actor);
    return actionResultResponse(result, 201);
  });
}
