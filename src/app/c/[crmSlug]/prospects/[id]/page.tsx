import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlugOrNotFound, assertBelongsToCrmOrNotFound } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { ProspectDetail } from "./prospect-detail";

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ crmSlug: string; id: string }>;
}) {
  const { crmSlug, id } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug, Permission.MANAGE_PROSPECTS);

  const prospect = await prisma.prospect.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      source: true,
      tags: { include: { tag: true } },
      contacts: { orderBy: { createdAt: "asc" } },
      convertedTo: { select: { id: true } },
    },
  });
  if (!prospect) notFound();
  assertBelongsToCrmOrNotFound(prospect.crmId, tenant, "Prospect");

  const [activity, sources, tags, members, appointments, tasks, opportunities] = await Promise.all([
    // "Activité récente" de la fiche ne montre que les 24 dernières heures.
    prisma.activityLog.findMany({
      where: { crmId: tenant.crmId, prospectId: id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.source.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
    prisma.tag.findMany({ where: { crmId: tenant.crmId, scope: "PROSPECT" }, orderBy: { name: "asc" } }),
    // Voir le commentaire équivalent dans prospects/page.tsx : seuls les
    // commerciaux (et les admins globaux) peuvent être commercial alloué.
    listCrmMembers(tenant.crmId).then((all) => all.filter((m) => m.isGlobalAdmin || m.category === "COMMERCIAL")),
    prisma.appointment.findMany({
      where: { crmId: tenant.crmId, prospectId: id },
      orderBy: { startAt: "desc" },
      select: { id: true, title: true, startAt: true, status: true },
    }),
    prisma.task.findMany({
      where: { crmId: tenant.crmId, prospectId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, dueAt: true },
    }),
    prisma.opportunity.findMany({
      where: { crmId: tenant.crmId, prospectId: id },
      select: { id: true, title: true, amount: true, stage: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const breakdown = Array.isArray(prospect.scoreBreakdown)
    ? (prospect.scoreBreakdown as { label: string; points: number }[])
    : [];

  const serialized = {
    id: prospect.id,
    company: prospect.company,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    phone: prospect.phone,
    email: prospect.email,
    address: prospect.address,
    siret: prospect.siret,
    sector: prospect.sector,
    activity: prospect.activity,
    size: prospect.size,
    sourceId: prospect.sourceId,
    sourceName: prospect.source?.name ?? null,
    ownerId: prospect.ownerId,
    owner: prospect.owner,
    status: prospect.status,
    score: prospect.score,
    scoreBreakdown: breakdown,
    potentialAmount: prospect.potentialAmount ? Number(prospect.potentialAmount) : null,
    notes: prospect.notes,
    lastContactAt: prospect.lastContactAt ? prospect.lastContactAt.toISOString().slice(0, 10) : null,
    nextContactAt: prospect.nextContactAt ? prospect.nextContactAt.toISOString().slice(0, 10) : null,
    lostReason: prospect.lostReason,
    createdAt: prospect.createdAt.toISOString(),
    tags: prospect.tags.map((t) => ({ id: t.tag.id, name: t.tag.name })),
    contacts: prospect.contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      role: c.role,
      phone: c.phone,
      email: c.email,
    })),
    convertedClientId: prospect.convertedTo?.id ?? null,
  };

  return (
    <ProspectDetail
      crmSlug={crmSlug}
      crmId={tenant.crmId}
      prospect={serialized}
      activity={activity.map((a) => ({
        id: a.id,
        action: a.action,
        createdAt: a.createdAt.toISOString(),
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : "Système",
      }))}
      appointments={appointments.map((a) => ({ id: a.id, title: a.title, startAt: a.startAt.toISOString(), status: a.status }))}
      tasks={tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt ? t.dueAt.toISOString() : null }))}
      opportunities={opportunities.map((o) => ({
        id: o.id,
        title: o.title,
        amount: o.amount ? Number(o.amount) : null,
        stageName: o.stage.name,
        stageColor: o.stage.color,
      }))}
      sources={sources}
      tags={tags}
      members={members}
      currentUserId={ctx.user.id}
      canEdit={tenant.permissions.has(Permission.EDIT)}
      canDelete={tenant.permissions.has(Permission.DELETE)}
      canConvert={tenant.permissions.has(Permission.MANAGE_CLIENTS)}
    />
  );
}
