import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, AuthError } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm, canManageOperations } from "@/server/tenant";
import { getStorageDriver } from "@/lib/storage";

/**
 * Téléchargement d'un document de coffre-fort : réservé au propriétaire du
 * document ou à un administrateur du CRM (MANAGE_SETTINGS). L'appartenance
 * au CRM seule ne suffit jamais ici — un ouvrier ne doit jamais pouvoir
 * récupérer la fiche de paie d'un autre ouvrier en devinant son id.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const document = await prisma.vaultDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const tenant = await requireCrmAccess(ctx, document.crmId);
    assertBelongsToCrm(document.crmId, tenant, "Document");
    const isOwner = document.userId === ctx.user.id;
    const isAdmin = canManageOperations(tenant);
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }

  const driver = getStorageDriver();
  const buffer = await driver.get(document.storageKey);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(document.fileName)}"`,
      "Content-Length": String(document.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
