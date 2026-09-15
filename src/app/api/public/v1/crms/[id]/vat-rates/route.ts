import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, unauthorizedResponse } from "@/server/public-api/auth";

/**
 * Table de correspondance en lecture : créer un devis (`POST
 * .../quotes`) exige un `vatRateId` réel par ligne, jamais exposé ailleurs
 * dans l'API publique.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { id } = await params;
  const crm = await prisma.crm.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!crm || !crm.isActive) return NextResponse.json({ error: "CRM introuvable." }, { status: 404 });

  const vatRates = await prisma.vatRate.findMany({
    where: { crmId: id },
    orderBy: { rate: "asc" },
    select: { id: true, label: true, rate: true, isDefault: true },
  });

  const data = vatRates.map((v) => ({ ...v, rate: Number(v.rate) }));
  return NextResponse.json({ data });
}
