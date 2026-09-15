import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { listVaultMembers } from "@/server/vault/actions";
import { AdminVaultPanel } from "@/app/c/[crmSlug]/vault/vault-client";
import { cn } from "@/lib/utils";

export default async function AdminVaultPage({
  searchParams,
}: {
  searchParams: Promise<{ crm?: string }>;
}) {
  const ctx = await requireAuth();
  // Next.js peut rendre layout.tsx et page.tsx en parallèle : le redirect()
  // du layout admin pour un non-admin ne bloque pas forcément le rendu de
  // cette page, dont l'appel à listVaultMembers (permission MANAGE_SETTINGS)
  // finissait alors par lever une AuthError non interceptée → 500 en prod.
  if (!ctx.user.isGlobalAdmin) notFound();

  const { crm: crmParam } = await searchParams;

  const crms = await prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  if (crms.length === 0) {
    return <p className="text-sm text-muted">Aucun CRM actif.</p>;
  }
  const selectedSlug = crmParam && crms.some((c) => c.slug === crmParam) ? crmParam : crms[0]!.slug;
  const tenant = await requireCrmAccessBySlug(ctx, selectedSlug);

  const members = await listVaultMembers(tenant.crmId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Coffres-forts</h1>
        <p className="text-sm text-muted">
          Déposez individuellement les fiches de paie et documents de chaque utilisateur. Chacun ne voit que ses
          propres documents.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {crms.map((c) => (
          <Link
            key={c.id}
            href={`/admin/vault?crm=${c.slug}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              c.slug === selectedSlug ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted hover:text-text"
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {/* key={tenant.crmId} : mêmes onglets ?crm=... que /admin/planning — sans clé, React réutilise
          l'instance du panneau entre deux CRM et garde en état la personne/les documents sélectionnés
          du CRM précédent. */}
      <AdminVaultPanel key={tenant.crmId} crmId={tenant.crmId} members={members} />
    </div>
  );
}
