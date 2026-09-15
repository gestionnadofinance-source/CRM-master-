import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, canManageOperations } from "@/server/tenant";
import { notFound } from "next/navigation";
import { listCrmUsers } from "@/server/crm-users/actions";
import { UsersClient } from "./users-client";

/**
 * Gestion des utilisateurs SCOPÉE à ce seul CRM — équivalent restreint de
 * /admin/users pour les catégories qui n'ont pas accès à l'administration
 * globale (SECRETAIRE) mais doivent pouvoir gérer les accès des personnes
 * de leur(s) CRM. Voir src/server/crm-users/actions.ts.
 */
export default async function CrmUsersPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  if (!canManageOperations(tenant)) notFound();

  const users = await listCrmUsers(tenant.crmId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Utilisateurs</h1>
        <p className="text-sm text-muted">{tenant.crmName} — {users.length} compte(s).</p>
      </div>
      <UsersClient crmId={tenant.crmId} initialUsers={users} currentUserId={ctx.user.id} />
    </div>
  );
}
