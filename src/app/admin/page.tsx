import Link from "next/link";
import { notFound } from "next/navigation";
import { Users, UserPlus, CalendarDays, FileText, TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requireAuth } from "@/server/auth/session";
import { getCrmDashboardRows } from "@/server/admin/queries";

export default async function AdminDashboardPage() {
  // Next.js peut rendre layout.tsx et page.tsx en parallèle : le redirect()
  // du layout pour un utilisateur non-admin n'empêche pas forcément cette
  // page de démarrer son propre rendu avant que la redirection n'aboutisse.
  // Sans ce garde-fou explicite, un Ouvrier arrivant ici (lien en cache,
  // retour navigateur) pouvait provoquer une exception serveur (500) ou,
  // pire, entrapercevoir des données avant la redirection.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const rows = await getCrmDashboardRows();
  const totalAccessRows = rows.reduce((sum, r) => sum + r.activeUsers, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Tableau de bord administrateur</h1>
        <p className="text-sm text-muted">
          Vue d&apos;ensemble par CRM — {rows.length} espace(s), {totalAccessRows} accès utilisateur(s) actif(s) au total.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((crm) => (
          <Card key={crm.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: crm.color }} />
                <CardTitle>
                  <Link href={`/c/${crm.slug}/dashboard`} className="hover:text-brand">
                    {crm.name}
                  </Link>
                </CardTitle>
                {!crm.isActive && <Badge variant="warning">Inactif</Badge>}
              </div>
              <Link href={`/admin/crms/${crm.id}`} className="text-xs text-muted hover:text-brand">
                Configurer
              </Link>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                <Stat icon={Users} label="Utilisateurs" value={crm.activeUsers} />
                <Stat icon={UserPlus} label="Prospects" value={crm.prospects} />
                <Stat icon={Users} label="Clients" value={crm.clients} />
                <Stat icon={CalendarDays} label="RDV" value={crm.appointments} />
                <Stat icon={FileText} label="Devis" value={crm.quotes} />
              </div>
              <div className="flex items-center gap-2 rounded-md bg-bg-subtle px-3 py-2 text-sm">
                <TrendingUp className="h-4 w-4 text-brand" />
                <span className="text-muted">CA devis acceptés :</span>
                <span className="font-semibold text-text">{formatCurrency(crm.revenueAccepted)}</span>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Activité récente</p>
                {crm.recentActivity.length === 0 ? (
                  <p className="text-sm text-muted">Aucune activité récente.</p>
                ) : (
                  <ul className="space-y-1">
                    {crm.recentActivity.map((a) => (
                      <li key={a.id} className="flex items-center justify-between text-xs text-muted">
                        <span className="truncate">
                          {a.userName ?? "Système"} · {a.action}
                        </span>
                        <span className="shrink-0">{formatDate(a.createdAt, true)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-2.5 text-center">
      <Icon className="mx-auto h-4 w-4 text-muted" />
      <p className="mt-1 text-lg font-semibold text-text">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
