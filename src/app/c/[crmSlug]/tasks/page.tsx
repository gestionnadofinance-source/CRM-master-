import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, requireCommercial } from "@/server/tenant";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { Card, Badge } from "@/components/ui/card";
import { Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TasksClient } from "./tasks-client";
import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crmSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  requireCommercial(tenant);

  const view = one(sp, "view") || "all"; // all | today | overdue | upcoming
  const assigneeId = one(sp, "assignee");
  const status = one(sp, "status");
  const priority = one(sp, "priority");
  const openTaskId = one(sp, "task") || null;
  const newForClientId = one(sp, "newForClient") || null;
  const newForProspectId = one(sp, "newForProspect") || null;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const statusFilter = status && status !== "all" ? (status as TaskStatus) : undefined;
  const excludeDoneByDefault = !statusFilter && (view === "today" || view === "overdue" || view === "upcoming");

  let dueFilter: Prisma.DateTimeFilter | undefined;
  if (view === "today") dueFilter = { gte: startOfDay, lte: endOfDay };
  else if (view === "overdue") dueFilter = { lt: startOfDay };
  else if (view === "upcoming") dueFilter = { gt: endOfDay };

  const where: Prisma.TaskWhereInput = {
    crmId: tenant.crmId,
    ...(assigneeId ? { assigneeId } : {}),
    ...(priority && priority !== "all" ? { priority: priority as TaskPriority } : {}),
    ...(statusFilter ? { status: statusFilter } : excludeDoneByDefault ? { status: { not: "DONE" } } : {}),
    ...(dueFilter ? { dueAt: dueFilter } : {}),
  };

  const [tasks, members, clients, prospects, quotes, appointments, overdueCount, todayCount, upcomingCount, openTask, prefillClient, prefillProspect] =
    await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
        take: 300,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true, color: true } },
          client: { select: { id: true, company: true } },
          prospect: { select: { id: true, company: true } },
          quote: { select: { id: true, number: true } },
          appointment: { select: { id: true, title: true } },
        },
      }),
      listCrmMembers(tenant.crmId),
      prisma.client.findMany({
        where: { crmId: tenant.crmId },
        select: { id: true, company: true },
        orderBy: { company: "asc" },
        take: 500,
      }),
      // Un prospect converti a désormais sa propre fiche client : il ne doit
      // plus apparaître dans la liste des prospects, seulement des clients.
      prisma.prospect.findMany({
        where: { crmId: tenant.crmId, status: { not: "CONVERTED" } },
        select: { id: true, company: true },
        orderBy: { company: "asc" },
        take: 500,
      }),
      prisma.quote.findMany({
        where: { crmId: tenant.crmId },
        select: { id: true, number: true, object: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.appointment.findMany({
        where: { crmId: tenant.crmId },
        select: { id: true, title: true, startAt: true },
        orderBy: { startAt: "desc" },
        take: 500,
      }),
      prisma.task.count({ where: { crmId: tenant.crmId, status: { not: "DONE" }, dueAt: { lt: startOfDay } } }),
      prisma.task.count({
        where: { crmId: tenant.crmId, status: { not: "DONE" }, dueAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.task.count({ where: { crmId: tenant.crmId, status: { not: "DONE" }, dueAt: { gt: endOfDay } } }),
      openTaskId
        ? prisma.task.findUnique({
            where: { id: openTaskId },
            include: {
              assignee: { select: { id: true, firstName: true, lastName: true, color: true } },
              client: { select: { id: true, company: true } },
              prospect: { select: { id: true, company: true } },
              quote: { select: { id: true, number: true } },
              appointment: { select: { id: true, title: true } },
            },
          })
        : Promise.resolve(null),
      newForClientId
        ? prisma.client.findUnique({ where: { id: newForClientId }, select: { id: true, crmId: true, company: true } })
        : Promise.resolve(null),
      newForProspectId
        ? prisma.prospect.findUnique({ where: { id: newForProspectId }, select: { id: true, crmId: true, company: true } })
        : Promise.resolve(null),
    ]);

  const safeOpenTask = openTask && openTask.crmId === tenant.crmId ? openTask : null;
  const safePrefillClient = prefillClient && prefillClient.crmId === tenant.crmId ? prefillClient : null;
  const safePrefillProspect = prefillProspect && prefillProspect.crmId === tenant.crmId ? prefillProspect : null;

  function tabHref(nextView: string): string {
    const params = new URLSearchParams();
    if (nextView !== "all") params.set("view", nextView);
    if (assigneeId) params.set("assignee", assigneeId);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    const qs = params.toString();
    return `/c/${crmSlug}/tasks${qs ? `?${qs}` : ""}`;
  }

  const tabs: { key: string; label: string; count?: number }[] = [
    { key: "all", label: "Toutes" },
    { key: "today", label: "À faire aujourd'hui", count: todayCount },
    { key: "overdue", label: "En retard", count: overdueCount },
    { key: "upcoming", label: "À venir", count: upcomingCount },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Tâches</h1>
        <p className="text-sm text-muted">{tenant.crmName}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link key={tab.key} href={tabHref(tab.key)}>
            <Button variant={view === tab.key ? "primary" : "outline"} size="sm">
              {tab.label}
              {typeof tab.count === "number" && (
                <Badge variant={view === tab.key ? "default" : tab.key === "overdue" && tab.count > 0 ? "danger" : "default"}>
                  {tab.count}
                </Badge>
              )}
            </Button>
          </Link>
        ))}
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input type="hidden" name="view" value={view !== "all" ? view : ""} />
          <div>
            <Label htmlFor="assignee">Responsable</Label>
            <Select id="assignee" name="assignee" defaultValue={assigneeId}>
              <option value="">Tous</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Statut</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">Tous</option>
              <option value="TODO">À faire</option>
              <option value="IN_PROGRESS">En cours</option>
              <option value="DONE">Terminée</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="priority">Priorité</Label>
            <Select id="priority" name="priority" defaultValue={priority}>
              <option value="">Toutes</option>
              <option value="LOW">Basse</option>
              <option value="NORMAL">Normale</option>
              <option value="HIGH">Haute</option>
              <option value="URGENT">Urgente</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Filtrer
            </Button>
            <Link href={`/c/${crmSlug}/tasks${view !== "all" ? `?view=${view}` : ""}`}>
              <Button type="button" variant="ghost" size="sm">
                Réinitialiser
              </Button>
            </Link>
          </div>
        </form>
      </Card>

      <TasksClient
        crmId={tenant.crmId}
        crmSlug={crmSlug}
        currentUserId={ctx.user.id}
        members={members}
        clients={clients}
        prospects={prospects}
        quotes={quotes.map((q) => ({ id: q.id, label: `${q.number} — ${q.object}` }))}
        appointments={appointments.map((a) => ({ id: a.id, label: `${a.title} (${a.startAt.toISOString()})` }))}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          dueAt: t.dueAt ? t.dueAt.toISOString() : null,
          assignee: t.assignee,
          clientId: t.clientId,
          clientName: t.client?.company ?? null,
          prospectId: t.prospectId,
          prospectName: t.prospect?.company ?? null,
          quoteId: t.quoteId,
          quoteNumber: t.quote?.number ?? null,
          appointmentId: t.appointmentId,
          appointmentTitle: t.appointment?.title ?? null,
          isAutomated: t.isAutomated,
        }))}
        openTask={
          safeOpenTask
            ? {
                id: safeOpenTask.id,
                title: safeOpenTask.title,
                description: safeOpenTask.description,
                priority: safeOpenTask.priority,
                status: safeOpenTask.status,
                dueAt: safeOpenTask.dueAt ? safeOpenTask.dueAt.toISOString() : null,
                assigneeId: safeOpenTask.assigneeId,
                clientId: safeOpenTask.clientId,
                prospectId: safeOpenTask.prospectId,
                quoteId: safeOpenTask.quoteId,
                appointmentId: safeOpenTask.appointmentId,
              }
            : null
        }
        prefill={
          safePrefillClient
            ? { kind: "client" as const, id: safePrefillClient.id, label: safePrefillClient.company }
            : safePrefillProspect
              ? { kind: "prospect" as const, id: safePrefillProspect.id, label: safePrefillProspect.company }
              : null
        }
      />
    </div>
  );
}
