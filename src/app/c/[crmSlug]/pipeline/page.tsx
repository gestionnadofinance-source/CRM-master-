import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { PipelineBoard, type OpportunityCard, type StageData } from "./pipeline-board";

export default async function PipelinePage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_PROSPECTS);

  const [stages, opportunities, clients, prospects, members] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
    prisma.opportunity.findMany({
      where: { crmId: tenant.crmId },
      include: {
        owner: { select: { firstName: true, lastName: true, color: true } },
        client: { select: { id: true, company: true } },
        prospect: { select: { id: true, company: true, score: true } },
      },
      orderBy: { position: "asc" },
    }),
    prisma.client.findMany({ where: { crmId: tenant.crmId }, select: { id: true, company: true }, orderBy: { company: "asc" }, take: 500 }),
    prisma.prospect.findMany({
      where: { crmId: tenant.crmId, status: { notIn: ["CONVERTED", "LOST"] } },
      select: { id: true, company: true },
      orderBy: { company: "asc" },
      take: 500,
    }),
    listCrmMembers(tenant.crmId),
  ]);

  const stageData: StageData[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
  }));

  const cards: OpportunityCard[] = opportunities.map((o) => {
    const entity = o.client ?? o.prospect ?? null;
    const entityHref = o.client ? `/clients/${o.client.id}` : o.prospect ? `/prospects/${o.prospect.id}` : null;
    return {
      id: o.id,
      title: o.title,
      amount: o.amount ? Number(o.amount) : null,
      stageId: o.stageId,
      position: o.position,
      ownerName: `${o.owner.firstName} ${o.owner.lastName}`,
      ownerColor: o.owner.color,
      entityName: entity?.company ?? null,
      entityHref,
      prospectScore: o.prospect?.score ?? null,
      lastActivityAt: o.lastActivityAt.toISOString(),
      nextAction: o.nextAction,
      clientId: o.clientId,
      prospectId: o.prospectId,
    };
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Pipeline</h1>
        <p className="text-sm text-muted">{tenant.crmName} · {opportunities.length} opportunité(s)</p>
      </div>

      <PipelineBoard
        crmId={tenant.crmId}
        crmSlug={crmSlug}
        stages={stageData}
        opportunities={cards}
        clients={clients}
        prospects={prospects}
        members={members}
        currentUserId={ctx.user.id}
        canCreate={tenant.permissions.has(Permission.CREATE)}
        canManageSettings={tenant.permissions.has(Permission.MANAGE_SETTINGS)}
      />
    </div>
  );
}
