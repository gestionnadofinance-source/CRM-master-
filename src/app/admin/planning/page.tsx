import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { listChantiers, listCrmMembersForPlanning } from "@/server/planning/actions";
import { PlanningClient } from "@/app/c/[crmSlug]/planning/planning-client";
import { cn } from "@/lib/utils";

export default async function AdminPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ crm?: string }>;
}) {
  const ctx = await requireAuth();
  // Next.js peut rendre layout.tsx et page.tsx en parallèle : le redirect()
  // du layout admin pour un non-admin ne bloque pas forcément le rendu de
  // cette page, dont listCrmMembersForPlanning (permission MANAGE_SETTINGS)
  // finissait alors par lever une AuthError non interceptée → 500 en prod.
  if (!ctx.user.isGlobalAdmin) notFound();

  const { crm: crmParam } = await searchParams;

  const crms = await prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  if (crms.length === 0) {
    return <p className="text-sm text-muted">Aucun CRM actif.</p>;
  }
  const selectedSlug = crmParam && crms.some((c) => c.slug === crmParam) ? crmParam : crms[0]!.slug;
  const tenant = await requireCrmAccessBySlug(ctx, selectedSlug);

  const [chantiers, members] = await Promise.all([
    listChantiers(tenant.crmId),
    listCrmMembersForPlanning(tenant.crmId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Planning</h1>
        <p className="text-sm text-muted">Chantiers annuels et affectations, tous CRM confondus.</p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {crms.map((c) => (
          <Link
            key={c.id}
            href={`/admin/planning?crm=${c.slug}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              c.slug === selectedSlug ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted hover:text-text"
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {/*
        key={tenant.crmId} est indispensable : /admin/planning reste sur la
        même route (seul le paramètre ?crm= change), donc React réutilise la
        même instance de PlanningClient entre deux onglets au lieu de la
        remonter. Sans clé, son état interne (useState(initialChantiers))
        n'est initialisé qu'au tout premier montage et ne se resynchronise
        jamais avec les nouveaux chantiers reçus en props lors du
        changement d'onglet — l'admin continuait donc de voir la liste (ou
        l'absence) de chantiers du CRM précédemment consulté.
      */}
      <PlanningClient
        key={tenant.crmId}
        crmId={tenant.crmId}
        canManage
        currentUserId={ctx.user.id}
        initialChantiers={chantiers}
        members={members}
      />
    </div>
  );
}
