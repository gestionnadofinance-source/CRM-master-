import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, canManageOperations } from "@/server/tenant";
import { listAccountingGroups } from "@/server/accounting/actions";
import { ComptabiliteClient } from "./comptabilite-client";

/**
 * Tableaux de comptabilité générés à partir des fiches de pointage
 * déposées (voir "Transformer en tableau de comptabilité" dans le
 * coffre-fort — src/server/accounting/actions.ts), classés par chef de
 * chantier puis par salarié. Réservé aux administrateurs et à la
 * catégorie SECRETAIRE (jamais aux données commerciales) — voir
 * canManageOperations dans src/server/tenant.ts.
 */
export default async function ComptabilitePage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  if (!canManageOperations(tenant)) notFound();

  const groups = await listAccountingGroups(tenant.crmId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Comptabilité</h1>
        <p className="text-sm text-muted">
          {tenant.crmName} — tableaux de comptabilité générés à partir des fiches de pointage déposées, classés par
          chef de chantier puis par salarié.
        </p>
      </div>
      <ComptabiliteClient crmId={tenant.crmId} groups={groups} />
    </div>
  );
}
