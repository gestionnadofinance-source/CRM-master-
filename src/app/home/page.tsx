import Link from "next/link";
import { requireActiveAuth } from "@/server/auth/session";
import { listAccessibleCrms } from "@/server/tenant";
import { GlobalTopbar } from "@/components/global-topbar";
import { Card } from "@/components/ui/card";
import { Building2 } from "lucide-react";

export default async function HomePage() {
  const ctx = await requireActiveAuth();
  const crms = await listAccessibleCrms(ctx);

  return (
    <div className="min-h-screen bg-bg-subtle">
      <GlobalTopbar user={ctx.user} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-text">Bonjour {ctx.user.firstName},</h1>
        <p className="mt-1 text-sm text-muted">Sélectionnez l&apos;espace que vous souhaitez ouvrir.</p>

        {crms.length === 0 ? (
          <Card className="mt-8 p-8 text-center text-sm text-muted">
            Aucun espace ne vous a été attribué pour le moment. Contactez un administrateur.
          </Card>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {crms.map((crm) => (
              // Lien direct vers Planning, page d'entrée commune à toutes
              // les catégories : ne pas compter sur une redirection du
              // layout /c/[crmSlug] pendant une navigation côté client
              // (clic sur ce <Link>), qui peut aboutir sur une page
              // blanche — voir listAccessibleCrms.
              <Link key={crm.id} href={`/c/${crm.slug}/planning`}>
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
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
