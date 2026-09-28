import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { canManageOperations, requireCrmAccessBySlugOrNotFound } from "@/server/tenant";
import { loadSilaePageData } from "@/server/silae/page-data";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { SilaeClient } from "./silae-client";

export default async function SilaePage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug);
  // Le layout filtre déjà la navigation, mais Next.js ne le réexécute pas
  // lors d'une navigation côté client : chaque page refait le contrôle.
  if (!canManageOperations(tenant)) notFound();

  const data = await loadSilaePageData(tenant.crmId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Import Silae</h1>
        <p className="text-sm text-muted">
          Génère le fichier d&apos;éléments variables à importer dans Silae (Traitement Mois &gt; Import de données
          variables &gt; import standard « importsilae »). L&apos;export Excel reste disponible dans Comptabilité.
        </p>
      </div>

      <SilaeClient
        crmId={tenant.crmId}
        rubriques={RUBRIQUES.map((r) => ({ key: r.key, label: r.label, unit: r.unit, note: r.note ?? null }))}
        {...data}
      />
    </div>
  );
}
