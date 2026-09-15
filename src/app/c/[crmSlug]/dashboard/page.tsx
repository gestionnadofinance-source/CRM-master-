import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, requireCommercial } from "@/server/tenant";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import Link from "next/link";
import { CalendarClock, CheckSquare, Flame, FileText, TrendingUp } from "lucide-react";

export default async function DashboardPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  requireCommercial(tenant, { allowSecretaire: true });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const [
    myAppointmentsToday,
    myOverdueTasks,
    myTasksToday,
    hotProspects,
    newClients,
    quotesPending,
    quotesAccepted,
    quotesTotal,
    recentActivity,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { crmId: tenant.crmId, ownerId: ctx.user.id, startAt: { gte: startOfDay, lte: endOfDay } },
      orderBy: { startAt: "asc" },
      include: { client: true, prospect: true },
    }),
    prisma.task.findMany({
      where: { crmId: tenant.crmId, assigneeId: ctx.user.id, status: { not: "DONE" }, dueAt: { lt: startOfDay } },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: { crmId: tenant.crmId, assigneeId: ctx.user.id, status: { not: "DONE" }, dueAt: { gte: startOfDay, lte: endOfDay } },
      orderBy: { priority: "desc" },
      take: 8,
    }),
    prisma.prospect.findMany({
      where: { crmId: tenant.crmId, status: "HOT" },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.client.findMany({
      where: { crmId: tenant.crmId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.quote.count({ where: { crmId: tenant.crmId, status: { in: ["DRAFT", "SENT", "FOLLOWED_UP"] } } }),
    prisma.quote.aggregate({
      where: { crmId: tenant.crmId, status: "ACCEPTED" },
      _sum: { totalHt: true },
      _count: true,
    }),
    prisma.quote.aggregate({ where: { crmId: tenant.crmId }, _sum: { totalHt: true }, _count: true }),
    // "Activité récente" ne montre que les 24 dernières heures — l'historique
    // complet reste consultable sur la page Activité dédiée du CRM.
    prisma.activityLog.findMany({
      where: { crmId: tenant.crmId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { firstName: true, lastName: true, color: true } } },
    }),
  ]);

  const conversionRate =
    quotesTotal._count > 0 ? Math.round(((quotesAccepted._count ?? 0) / quotesTotal._count) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Tableau de bord</h1>
        <p className="text-sm text-muted">{tenant.crmName}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={CalendarClock} label="RDV aujourd'hui" value={myAppointmentsToday.length} />
        <KpiCard icon={CheckSquare} label="Tâches en retard" value={myOverdueTasks.length} danger={myOverdueTasks.length > 0} />
        <KpiCard icon={Flame} label="Prospects chauds" value={hotProspects.length} />
        <KpiCard icon={FileText} label="Devis en cours" value={quotesPending} />
        <KpiCard icon={TrendingUp} label="Taux de conversion" value={`${conversionRate}%`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ma journée</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Rendez-vous</p>
              {myAppointmentsToday.length === 0 && <p className="text-sm text-muted">Aucun rendez-vous aujourd&apos;hui.</p>}
              <ul className="space-y-1.5">
                {myAppointmentsToday.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/c/${crmSlug}/agenda?appointment=${a.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-bg-subtle"
                    >
                      <span className="text-text">{a.title}</span>
                      <span className="text-xs text-muted">{formatDate(a.startAt, true)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Tâches du jour</p>
              {myTasksToday.length === 0 && <p className="text-sm text-muted">Rien de prévu aujourd&apos;hui.</p>}
              <ul className="space-y-1.5">
                {myTasksToday.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/c/${crmSlug}/tasks?task=${t.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-bg-subtle"
                    >
                      <span className="text-text">{t.title}</span>
                      <Badge variant={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "default"}>
                        {t.priority}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            {myOverdueTasks.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-500">Tâches en retard</p>
                <ul className="space-y-1.5">
                  {myOverdueTasks.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/c/${crmSlug}/tasks?task=${t.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-red-500/10"
                      >
                        <span className="text-text">{t.title}</span>
                        <span className="text-xs text-red-500">{formatDate(t.dueAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 && <p className="text-sm text-muted">Aucune activité récente.</p>}
            <ul className="space-y-3">
              {recentActivity.map((log) => (
                <li key={log.id} className="text-sm">
                  <span className="font-medium text-text">
                    {log.user ? `${log.user.firstName} ${log.user.lastName}` : "Système"}
                  </span>{" "}
                  <span className="text-muted">
                    {translateActivityAction(log.action)} · {formatDate(log.createdAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nouveaux prospects chauds</CardTitle>
          </CardHeader>
          <CardContent>
            {hotProspects.length === 0 && <p className="text-sm text-muted">Aucun prospect chaud actuellement.</p>}
            <ul className="divide-y divide-border">
              {hotProspects.map((p) => (
                <li key={p.id} className="py-2">
                  <Link href={`/c/${crmSlug}/prospects/${p.id}`} className="flex items-center justify-between text-sm hover:text-brand">
                    <span className="text-text">{p.company}</span>
                    <Badge variant="warning">Score {p.score}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Derniers clients ajoutés</CardTitle>
          </CardHeader>
          <CardContent>
            {newClients.length === 0 && <p className="text-sm text-muted">Aucun client pour le moment.</p>}
            <ul className="divide-y divide-border">
              {newClients.map((c) => (
                <li key={c.id} className="py-2">
                  <Link href={`/c/${crmSlug}/clients/${c.id}`} className="flex items-center justify-between text-sm hover:text-brand">
                    <span className="text-text">{c.company}</span>
                    <span className="text-xs text-muted">{formatCurrency(c.revenue)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${danger ? "text-red-500" : "text-text"}`}>{value}</p>
    </Card>
  );
}
