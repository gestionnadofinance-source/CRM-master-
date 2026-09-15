import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { listAccountingGroups } from "@/server/accounting/actions";
import { ComptabiliteClient } from "@/app/c/[crmSlug]/comptabilite/comptabilite-client";
import { cn } from "@/lib/utils";

/**
 * Comptabilité vue depuis l'administration globale : mêmes tableaux et
 * mêmes fonctions que /c/[crmSlug]/comptabilite, avec un sélecteur de CRM
 * en tête, pour qu'un administrateur n'ait pas à entrer dans chaque CRM
 * l'un après l'autre. Même forme que /admin/vault et /admin/planning, dont
 * ce fichier reprend délibérément la structure.
 */
export default async function AdminComptabilitePage({
  searchParams,
}: {
  searchParams: Promise<{ crm?: string }>;
}) {
  const ctx = await requireAuth();
  // Même garde que /admin/vault : Next.js peut rendre layout.tsx et page.tsx
  // en parallèle, si bien que le redirect() du layout admin pour un non-admin
  // ne bloque pas forcément le rendu de cette page — dont listAccountingGroups
  // (requireOperationsAccess) lèverait alors une AuthError non interceptée.
  if (!ctx.user.isGlobalAdmin) notFound();

  const { crm: crmParam } = await searchParams;

  const crms = await prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  if (crms.length === 0) {
    return <p className="text-sm text-muted">Aucun CRM actif.</p>;
  }
  const selectedSlug = crmParam && crms.some((c) => c.slug === crmParam) ? crmParam : crms[0]!.slug;
  const tenant = await requireCrmAccessBySlug(ctx, selectedSlug);

  const groups = await listAccountingGroups(tenant.crmId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Comptabilité</h1>
        <p className="text-sm text-muted">
          Tableaux de comptabilité générés à partir des fiches de pointage déposées, classés par chef de chantier
          puis par salarié.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {crms.map((c) => (
          <Link
            key={c.id}
            href={`/admin/comptabilite?crm=${c.slug}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              c.slug === selectedSlug ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted hover:text-text"
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {/* key={tenant.crmId} : comme /admin/vault et /admin/planning — sans clé, React réutilise
          l'instance entre deux CRM et conserve le chef de chantier / salarié sélectionné du CRM
          précédent. */}
      <ComptabiliteClient key={tenant.crmId} crmId={tenant.crmId} groups={groups} />
    </div>
  );
}
