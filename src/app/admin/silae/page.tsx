import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { loadSilaePageData } from "@/server/silae/page-data";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { SilaeClient } from "@/app/c/[crmSlug]/silae/silae-client";
import { cn } from "@/lib/utils";

/**
 * Import Silae vu depuis l'administration globale : mêmes onglets et mêmes
 * fonctions que /c/[crmSlug]/silae, avec un sélecteur d'espace en tête,
 * pour qu'un administrateur n'ait pas à entrer dans chaque espace l'un
 * après l'autre. Même forme que /admin/comptabilite, /admin/vault et
 * /admin/planning, dont ce fichier reprend délibérément la structure.
 */
export default async function AdminSilaePage({ searchParams }: { searchParams: Promise<{ crm?: string }> }) {
  const ctx = await requireAuth();
  // Même garde que /admin/comptabilite : Next.js peut rendre layout.tsx et
  // page.tsx en parallèle, si bien que le redirect() du layout admin pour un
  // non-admin ne bloque pas forcément le rendu de cette page.
  if (!ctx.user.isGlobalAdmin) notFound();

  const { crm: crmParam } = await searchParams;
  const crms = await prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  if (crms.length === 0) {
    return <p className="text-sm text-muted">Aucun espace actif.</p>;
  }
  const selectedSlug = crmParam && crms.some((c) => c.slug === crmParam) ? crmParam : crms[0]!.slug;
  const tenant = await requireCrmAccessBySlug(ctx, selectedSlug);

  const data = await loadSilaePageData(tenant.crmId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Import Silae</h1>
        <p className="text-sm text-muted">
          Génère le fichier d&apos;éléments variables à importer dans Silae (Traitement Mois &gt; Import de données
          variables &gt; import standard « importsilae »). Un fichier par mois et par espace.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {crms.map((c) => (
          <Link
            key={c.id}
            href={`/admin/silae?crm=${c.slug}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              c.slug === selectedSlug ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted hover:text-text"
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {/* key={tenant.crmId} : comme /admin/comptabilite — sans clé, React
          réutilise l'instance entre deux espaces et conserve l'onglet, le
          mois et le rapport calculés pour l'espace précédent. */}
      <SilaeClient
        key={tenant.crmId}
        crmId={tenant.crmId}
        rubriques={RUBRIQUES.map((r) => ({ key: r.key, label: r.label, unit: r.unit, note: r.note ?? null }))}
        {...data}
      />
    </div>
  );
}
