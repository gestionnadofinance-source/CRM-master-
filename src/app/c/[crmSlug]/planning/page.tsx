import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, canManageOperations } from "@/server/tenant";
import { listChantiers, listCrmMembersForPlanning } from "@/server/planning/actions";
import { PlanningClient } from "./planning-client";

export default async function PlanningPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const canManage = canManageOperations(tenant);
  const isOuvrier = tenant.category === "OUVRIER" && !tenant.isGlobalAdmin;
  const [chantiers, members] = await Promise.all([
    listChantiers(tenant.crmId),
    canManage ? listCrmMembersForPlanning(tenant.crmId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Planning</h1>
        <p className="text-sm text-muted">
          {tenant.crmName} —{" "}
          {isOuvrier ? "les chantiers auxquels vous êtes affecté" : `chantiers annuels et affectations${canManage ? "" : " (lecture seule)"}`}
        </p>
      </div>
      {/* key={tenant.crmId} : voir le commentaire équivalent dans /admin/planning — le sélecteur de CRM
          de la topbar peut naviguer d'un CRM à l'autre sans remonter cette page (même arbre de route),
          il faut donc forcer le remount pour resynchroniser l'état local du composant client. */}
      <PlanningClient
        key={tenant.crmId}
        crmId={tenant.crmId}
        canManage={canManage}
        isOuvrier={isOuvrier}
        currentUserId={ctx.user.id}
        initialChantiers={chantiers}
        members={members}
      />
    </div>
  );
}
