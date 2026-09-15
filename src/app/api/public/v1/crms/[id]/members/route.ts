import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, unauthorizedResponse } from "@/server/public-api/auth";
import { listCrmMembers } from "@/server/shared/members";

/**
 * Table de correspondance en lecture pour les appelants externes : les
 * routes d'écriture (créer un client/prospect/tâche/rendez-vous...)
 * exigent un `ownerId`/`assigneeId` réel (un utilisateur ayant accès à ce
 * CRM), mais aucune donnée client n'expose cet id directement (seul
 * `ownerName` apparaît dans les réponses de lecture). Cette route comble
 * ce manque sans exposer autre chose que ce qui est déjà nécessaire au
 * choix d'un commercial/assigné dans l'application elle-même — voir
 * `listCrmMembers`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await requireApiKey(request);
  if (!apiKey) return unauthorizedResponse();

  const { id } = await params;
  const crm = await prisma.crm.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!crm || !crm.isActive) return NextResponse.json({ error: "CRM introuvable." }, { status: 404 });

  const members = await listCrmMembers(id);
  const data = members.map((m) => ({
    id: m.id,
    name: `${m.firstName} ${m.lastName}`,
    category: m.category,
    isGlobalAdmin: m.isGlobalAdmin,
  }));

  return NextResponse.json({ data });
}
