import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, Badge } from "@/components/ui/card";
import { requireAuth } from "@/server/auth/session";
import { CreateCrmButton } from "./create-crm-button";

export default async function AdminCrmsPage() {
  // Voir le commentaire équivalent dans admin/page.tsx : le layout admin
  // ne suffit pas seul à empêcher un non-admin d'atteindre cette page.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const crms = await prisma.crm.findMany({
    orderBy: { order: "asc" },
    include: { _count: { select: { userAccess: true } } },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">CRM</h1>
          <p className="text-sm text-muted">{crms.length} espace(s) configuré(s).</p>
        </div>
        <CreateCrmButton />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">CRM</th>
                <th className="px-4 py-2.5 font-medium">Identifiant</th>
                <th className="px-4 py-2.5 font-medium">Utilisateurs</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {crms.map((crm) => (
                <tr key={crm.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: crm.color }} />
                      <span className="font-medium text-text">{crm.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{crm.slug}</td>
                  <td className="px-4 py-3 text-muted">{crm._count.userAccess}</td>
                  <td className="px-4 py-3">
                    <Badge variant={crm.isActive ? "success" : "default"}>
                      {crm.isActive ? "Actif" : "Inactif"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/crms/${crm.id}`} className="text-sm text-brand hover:underline">
                      Configurer
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
