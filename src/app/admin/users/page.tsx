import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { Card, Badge } from "@/components/ui/card";
import { formatDate, initials } from "@/lib/utils";
import { listAllUsers } from "@/server/admin/queries";
import { CreateUserButton } from "./create-user-button";
import { UserRowActions } from "./user-row-actions";

export default async function AdminUsersPage() {
  // Voir le commentaire équivalent dans admin/page.tsx : le layout admin
  // ne suffit pas seul à empêcher un non-admin d'atteindre cette page.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const [users, crms] = await Promise.all([
    listAllUsers(),
    prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Utilisateurs</h1>
          <p className="text-sm text-muted">{users.length} compte(s) au total.</p>
        </div>
        <CreateUserButton crms={crms} />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Utilisateur</th>
                <th className="px-4 py-2.5 font-medium">Rôle</th>
                <th className="px-4 py-2.5 font-medium">CRM</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Dernière connexion</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2.5 hover:text-brand">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                        {initials(u.firstName, u.lastName)}
                      </span>
                      <span>
                        <span className="block font-medium text-text">
                          {u.firstName} {u.lastName}
                        </span>
                        <span className="block text-xs text-muted">{u.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {u.isGlobalAdmin ? (
                      <Badge variant="brand">Administrateur global</Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.isGlobalAdmin ? (
                      <span className="text-xs text-muted">Tous les CRM</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.access.map((a) => (
                          <Badge key={a.crmId} variant={a.category === "OUVRIER" ? "warning" : "default"}>
                            {a.crmName} · {a.category === "OUVRIER" ? "Ouvrier" : a.role === "MANAGER" ? "Responsable" : "Utilisateur"}
                          </Badge>
                        ))}
                        {u.access.length === 0 && <span className="text-xs text-muted">Aucun accès</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.status === "ACTIVE" ? "success" : "danger"}>
                      {u.status === "ACTIVE" ? "Actif" : "Désactivé"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{u.lastSeenAt ? formatDate(u.lastSeenAt, true) : "Jamais"}</td>
                  <td className="px-4 py-3">
                    <UserRowActions userId={u.id} status={u.status} isSelf={u.id === ctx.user.id} />
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
