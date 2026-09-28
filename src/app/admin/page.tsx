import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange, ClipboardList, HardHat, Lock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { ACTIVITY_ACTION_LABELS } from "@/lib/activity-labels";
import { formatDate } from "@/lib/utils";
import { requireAuth } from "@/server/auth/session";
import { getAdminDashboard, type SpaceDashboardRow } from "@/server/admin/queries";

export default async function AdminDashboardPage() {
  // Next.js peut rendre layout.tsx et page.tsx en parallèle : le redirect()
  // du layout pour un utilisateur non-admin n'empêche pas forcément cette
  // page de démarrer son propre rendu avant que la redirection n'aboutisse.
  // Sans ce garde-fou explicite, un Ouvrier arrivant ici (lien en cache,
  // retour navigateur) pouvait provoquer une exception serveur (500) ou,
  // pire, entrapercevoir des données avant la redirection.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const { weekStart, totals, spaces } = await getAdminDashboard();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Tableau de bord</h1>
        <p className="text-sm text-muted">
          Résumé d&apos;exploitation — semaine du {formatDate(weekStart)}
          {spaces.length > 0 && <> · {spaces.map((s) => s.name).join(" et ")}</>}
        </p>
      </div>

      {/* Bandeau consolidé : les grandeurs qui répondent d'un coup d'œil à
          « où en est-on cette semaine ». */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroStat icon={CalendarRange} label="Chantiers en cours" value={totals.chantiersEnCours} />
        <HeroStat icon={ClipboardList} label="Pointages cette semaine" value={totals.pointagesSemaine} />
        <HeroStat icon={HardHat} label="Salariés affectés" value={totals.salariesAffectes} />
        <HeroStat icon={Lock} label="Documents au coffre-fort" value={totals.vaultDocuments} />
      </div>

      {spaces.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">Aucune entité configurée.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {spaces.map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarRange;
  label: string;
  value: number;
}) {
  return (
    // Valeur AVANT libellé : un libellé qui passe à la ligne ne décale plus
    // le chiffre, et les quatre tuiles gardent leurs chiffres alignés quelle
    // que soit la longueur des intitulés.
    <Card className="p-4">
      <p className="text-2xl font-semibold leading-none tabular-nums text-text">{value}</p>
      <div className="mt-2 flex items-center gap-1.5 text-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
    </Card>
  );
}

function SpaceCard({ space }: { space: SpaceDashboardRow }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          {/* La pastille de couleur porte l'identité de l'entité ; le texte
              reste sur les jetons de texte, jamais sur la couleur de l'entité. */}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: space.color }} />
          <CardTitle>
            <Link href={`/c/${space.slug}/planning`} className="hover:text-brand">
              {space.name}
            </Link>
          </CardTitle>
          {!space.isActive && <Badge variant="warning">Inactif</Badge>}
        </div>
        <Link href={`/c/${space.slug}/pointage-salaries`} className="text-xs text-muted hover:text-brand">
          Pointages
        </Link>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Chantiers en cours" value={space.chantiersEnCours} hint={`sur ${space.chantiersTotal}`} />
          <Stat label="Pointages / semaine" value={space.pointagesSemaine} hint={`${space.pointagesTotal} au total`} />
          <Stat label="Salariés affectés" value={space.salariesAffectes} />
          <Stat label="Utilisateurs" value={space.activeUsers} />
        </div>

        <Section title="Derniers pointages saisis">
          {space.derniersPointages.length === 0 ? (
            <p className="text-sm text-muted">Aucun pointage saisi.</p>
          ) : (
            <ul className="space-y-1">
              {space.derniersPointages.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-text">
                    {p.employeeName} <span className="text-muted">· {p.chantierName}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">sem. du {formatDate(p.weekStart)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Activité récente">
          {space.recentActivity.length === 0 ? (
            <p className="text-sm text-muted">Aucune activité récente.</p>
          ) : (
            <ul className="space-y-1">
              {space.recentActivity.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 text-xs text-muted">
                  <span className="min-w-0 truncate">
                    {a.userName ?? "Système"} · {ACTIVITY_ACTION_LABELS[a.action] ?? a.action}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2">
      <p className="text-lg font-semibold leading-tight tabular-nums text-text">{value}</p>
      <p className="text-[11px] leading-tight text-muted">{label}</p>
      {hint && <p className="text-[11px] leading-tight text-muted opacity-70">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}
