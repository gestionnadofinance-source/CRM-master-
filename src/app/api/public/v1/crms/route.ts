import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyReadRequest, unauthorizedResponse } from "@/server/public-api/auth";

/** Liste des CRM actifs — sert à résoudre crmId → nom/slug dans les autres endpoints. */
export async function GET(request: NextRequest) {
  const refus = await denyReadRequest(request);
  if (refus) return refus;

  const crms = await prisma.crm.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json({ data: crms });
}
