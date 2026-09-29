import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyReadRequest, requireWriteAccess, readPagination } from "@/server/public-api/auth";
import { jsonToFormData, actionResultResponse, withWriteErrorHandling } from "@/server/public-api/write-helpers";
import { upsertPointageEntryCore } from "@/server/pointage/core";

export async function GET(request: NextRequest) {
  const refus = await denyReadRequest(request);
  if (refus) return refus;

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
    const result = await upsertPointageEntryCore(access.actor, String(body.crmId), String(body.chantierId), jsonToFormData(formBody));
    // 201 seulement si la fiche vient d'être créée : cette route est un
    // upsert, et répondre 201 sur une mise à jour empêchait un client
    // d'apprendre ce qu'il avait réellement fait.
    return actionResultResponse(result, result.created ? 201 : 200);
  });
}
