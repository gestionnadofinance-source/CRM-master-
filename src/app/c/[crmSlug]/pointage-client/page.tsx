import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { amIForeman, listMyForemanChantiers } from "@/server/pointage/actions";
import { PointageClientSheetClient } from "./pointage-client-client";

export default async function PointageClientPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  // Onglet réservé aux chefs de chantier (et aux administrateurs / à la
  // catégorie SECRETAIRE, voir amIForeman). La navigation le masque déjà aux
  // autres, mais le masquage d'interface n'est jamais une protection : sans ce
  // contrôle la page restait atteignable par URL directe. Elle n'y montrait
  // rien — listMyForemanChantiers renvoie une liste vide à un non-chef — mais
  // une page accessible qui ne devrait pas l'être finit par le devenir.
  if (!(await amIForeman(tenant.crmId))) notFound();
  const chantiers = await listMyForemanChantiers(tenant.crmId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Feuille de pointage client</h1>
        <p className="text-sm text-muted">
          {tenant.crmName} — récapitulatif hebdomadaire du chantier, généré automatiquement à partir des heures
          saisies, à déposer dans un dossier de votre choix ou à envoyer par email.
        </p>
      </div>
      {chantiers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
          Vous n&apos;êtes chef de chantier sur aucun chantier pour le moment. Un administrateur doit vous affecter
          avec ce rôle depuis le Planning.
        </p>
      ) : (
        <PointageClientSheetClient crmId={tenant.crmId} chantiers={chantiers} />
      )}
    </div>
  );
}
