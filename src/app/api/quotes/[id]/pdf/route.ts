import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, AuthError } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { renderQuotePdfBuffer } from "@/server/quotes/pdf";

/**
 * Génère à la volée le PDF d'un devis. Le crmId n'est jamais pris depuis
 * l'URL/le client : on relit le devis en base pour connaître son crmId réel,
 * puis on vérifie l'accès de l'utilisateur à CE crm avant de servir le PDF.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const quote = await prisma.quote.findUnique({ where: { id }, select: { crmId: true, number: true } });
  if (!quote) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const tenant = await requireCrmAccess(ctx, quote.crmId, Permission.MANAGE_QUOTES);
    assertBelongsToCrm(quote.crmId, tenant, "Devis");
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }

  const rendered = await renderQuotePdfBuffer(id);
  if (!rendered) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(rendered.fileName)}"`,
      "Content-Length": String(rendered.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
