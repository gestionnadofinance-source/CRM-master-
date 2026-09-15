import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, AuthError } from "@/server/auth/session";
import { requireOperationsAccess, assertBelongsToCrm } from "@/server/tenant";
import { renderMissionOrderPdf } from "@/server/mission-order/pdf";
import { loadMissionOrderData } from "@/server/mission-order/data";

/**
 * Génère à la volée le PDF de l'ordre de mission d'un salarié sur un
 * chantier. Le crmId n'est jamais pris depuis l'URL/le client : on relit
 * le chantier en base pour connaître son crmId réel, puis on vérifie
 * l'accès de l'utilisateur à CE crm avant de servir le PDF (même schéma que
 * /api/quotes/[id]/pdf).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ chantierId: string; employeeId: string }> }) {
  const { chantierId, employeeId } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const chantier = await prisma.chantier.findUnique({ where: { id: chantierId }, select: { crmId: true, name: true } });
  if (!chantier) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const tenant = await requireOperationsAccess(ctx, chantier.crmId);
    assertBelongsToCrm(chantier.crmId, tenant, "Chantier");
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }

  const data = await loadMissionOrderData(chantierId, employeeId);
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const buffer = await renderMissionOrderPdf(data);
  const fileName = `Ordre de mission - ${data.employeeName} - ${chantier.name}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
