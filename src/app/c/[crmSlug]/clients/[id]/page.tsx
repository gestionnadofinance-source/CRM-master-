import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlugOrNotFound, assertBelongsToCrmOrNotFound } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { ClientDetail } from "./client-detail";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ crmSlug: string; id: string }>;
}) {
  const { crmSlug, id } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug, Permission.MANAGE_CLIENTS);

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      source: true,
      tags: { include: { tag: true } },
      contacts: { orderBy: { createdAt: "asc" } },
      collaborators: { include: { user: { select: { id: true, firstName: true, lastName: true, color: true } } } },
      convertedFrom: { select: { id: true, company: true } },
    },
  });
  if (!client) notFound();
  assertBelongsToCrmOrNotFound(client.crmId, tenant, "Client");

  const [activity, sources, tags, members, opportunities] = await Promise.all([
    // "Activité récente" de la fiche ne montre que les 24 dernières heures.
    prisma.activityLog.findMany({
      where: { crmId: tenant.crmId, clientId: id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true, color: true } } },
    }),
    prisma.source.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
    prisma.tag.findMany({ where: { crmId: tenant.crmId, scope: "CLIENT" }, orderBy: { name: "asc" } }),
    listCrmMembers(tenant.crmId),
    prisma.opportunity.findMany({
      where: { crmId: tenant.crmId, clientId: id },
      select: { id: true, title: true, amount: true, stage: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const serialized = {
    id: client.id,
    company: client.company,
    sector: client.sector,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    email: client.email,
    address: client.address,
    activity: client.activity,
    size: client.size,
    siret: client.siret,
    status: client.status,
    notes: client.notes,
    sourceId: client.sourceId,
    sourceName: client.source?.name ?? null,
    ownerId: client.ownerId,
    owner: client.owner,
    createdAt: client.createdAt.toISOString(),
    tags: client.tags.map((t) => ({ id: t.tag.id, name: t.tag.name })),
    contacts: client.contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      role: c.role,
      phone: c.phone,
      email: c.email,
    })),
    collaborators: client.collaborators.map((c) => ({ id: c.user.id, firstName: c.user.firstName, lastName: c.user.lastName })),
    convertedFrom: client.convertedFrom,
  };

  const opps = opportunities.map((o) => ({
    id: o.id,
    title: o.title,
    amount: o.amount ? Number(o.amount) : null,
    stageName: o.stage.name,
    stageColor: o.stage.color,
  }));

  return (
    <ClientDetail
      crmSlug={crmSlug}
      crmId={tenant.crmId}
      client={serialized}
      activity={activity.map((a) => ({
        id: a.id,
        action: a.action,
        createdAt: a.createdAt.toISOString(),
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : "Système",
      }))}
      opportunities={opps}
      sources={sources}
      tags={tags}
      members={members}
      currentUserId={ctx.user.id}
      canEdit={tenant.permissions.has(Permission.EDIT)}
      canDelete={tenant.permissions.has(Permission.DELETE)}
    />
  );
}
