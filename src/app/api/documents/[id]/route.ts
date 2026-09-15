import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/server/auth/session";
import { requireCrmAccess, assertBelongsToCrm } from "@/server/tenant";
import { getStorageDriver } from "@/lib/storage";
import { AuthError } from "@/server/auth/session";

/**
 * Téléchargement d'un document : vérifie systématiquement que le document
 * appartient au CRM auquel l'utilisateur a accès. Un utilisateur d'un CRM
 * ne peut jamais récupérer le document d'un autre CRM, même en devinant
 * son id.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const tenant = await requireCrmAccess(ctx, document.crmId);
    assertBelongsToCrm(document.crmId, tenant, "Document");

    // Une pièce jointe de message est en plus réservée aux participants du
    // fil qui la porte : l'accès au CRM seul ne suffit pas, sans quoi
    // n'importe quel membre du CRM pourrait deviner l'id d'un document
    // joint à une conversation privée à laquelle il n'appartient pas.
    if (document.entityType === "MESSAGE") {
      const message = await prisma.message.findUnique({
        where: { id: document.entityId },
        select: { threadId: true },
      });
      const isParticipant =
        message &&
        (await prisma.messageThreadParticipant.findUnique({
          where: { threadId_userId: { threadId: message.threadId, userId: ctx.user.id } },
        }));
      if (!isParticipant) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
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
