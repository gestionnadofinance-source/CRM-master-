import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, canManageOperations } from "@/server/tenant";
import { listMyVaultDocuments, listMyVaultFolders, listVaultMembers } from "@/server/vault/actions";
import { VaultClient } from "./vault-client";

export default async function VaultPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const canManage = canManageOperations(tenant);
  const [myDocuments, myFolders, members] = await Promise.all([
    listMyVaultDocuments(tenant.crmId),
    listMyVaultFolders(tenant.crmId),
    canManage ? listVaultMembers(tenant.crmId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Coffre-fort</h1>
        <p className="text-sm text-muted">
          {tenant.crmName} — vos documents personnels (fiches de paie, documents importants), déposés par un
          administrateur. Visibles uniquement par vous.
        </p>
      </div>
      <VaultClient crmId={tenant.crmId} canManage={canManage} myDocuments={myDocuments} myFolders={myFolders} members={members} />
    </div>
  );
}
