import Link from "next/link";
import { requireActiveAuth } from "@/server/auth/session";
import { listAccessibleCrms } from "@/server/tenant";
import { prisma } from "@/lib/prisma";
import { GlobalTopbar } from "@/components/global-topbar";
import { Card } from "@/components/ui/card";
import { Building2, CalendarClock, Flame, FileText, UserPlus } from "lucide-react";

async function crmStats(crmId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [appointmentsToday, followUps, newProspects, openQuotes] = await Promise.all([
    prisma.appointment.count({ where: { crmId, startAt: { gte: startOfDay, lte: endOfDay } } }),
    prisma.task.count({ where: { crmId, status: { not: "DONE" }, dueAt: { lte: endOfDay } } }),
    prisma.prospect.count({ where: { crmId, createdAt: { gte: weekAgo } } }),
    prisma.quote.count({ where: { crmId, status: { in: ["DRAFT", "SENT", "FOLLOWED_UP"] } } }),
  ]);

  return { appointmentsToday, followUps, newProspects, openQuotes };
}

export default async function HomePage() {
  const ctx = await requireActiveAuth();
  const crms = await listAccessibleCrms(ctx);
  // Un Ouvrier n'a pas accès aux données commerciales du CRM (RDV, prospects,
  // devis...) : on ne calcule ni n'affiche ces statistiques pour sa carte.
  const stats = await Promise.all(
    crms.map((crm) => (crm.category === "OUVRIER" ? Promise.resolve(null) : crmStats(crm.id)))
  );
  const crmCards = crms.map((crm, i) => ({ crm, stats: stats[i] ?? null }));

  return (
    <div className="min-h-screen bg-bg-subtle">
      <GlobalTopbar user={ctx.user} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-text">Bonjour {ctx.user.firstName},</h1>
        <p className="mt-1 text-sm text-muted">Sélectionnez le CRM que vous souhaitez ouvrir.</p>

        {crms.length === 0 ? (
          <Card className="mt-8 p-8 text-center text-sm text-muted">
            Aucun CRM ne vous a été attribué pour le moment. Contactez un administrateur.
          </Card>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {crmCards.map(({ crm, stats: s }) => (
              // Lien direct vers la bonne page selon la catégorie d'accès :
              // ne pas compter sur la redirection Ouvrier du layout
              // /c/[crmSlug] pendant une navigation côté client (clic sur
              // ce <Link>) qui peut aboutir sur une page blanche — voir
              // listAccessibleCrms.
              <Link key={crm.id} href={`/c/${crm.slug}/${crm.category === "OUVRIER" ? "planning" : "dashboard"}`}>
                <Card className="group h-full p-5 transition-shadow hover:shadow-md">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: crm.color }}
                    >
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-text group-hover:text-brand">{crm.name}</p>
                      {crm.description && <p className="text-xs text-muted">{crm.description}</p>}
                    </div>
                  </div>
                  {s && (
                    <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                      <StatItem icon={CalendarClock} label="RDV aujourd'hui" value={s.appointmentsToday} />
                      <StatItem icon={Flame} label="Relances" value={s.followUps} />
                      <StatItem icon={UserPlus} label="Nouveaux prospects" value={s.newProspects} />
                      <StatItem icon={FileText} label="Devis en cours" value={s.openQuotes} />
                    </div>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatItem({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-bg-subtle px-3 py-2">
      <Icon className="h-4 w-4 text-muted" />
      <div>
        <p className="font-semibold leading-none text-text">{value}</p>
        <p className="text-[11px] text-muted">{label}</p>
      </div>
    </div>
  );
}
