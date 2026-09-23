import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlugOrNotFound } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { getPointageSettings } from "@/server/pointage/actions";
import { SettingsTabs } from "./settings-tabs";

export default async function CrmSettingsPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug, Permission.MANAGE_SETTINGS);

  const [companySettings, pointageSettings] = await Promise.all([
    prisma.companySettings.findUnique({ where: { crmId: tenant.crmId } }),
    getPointageSettings(tenant.crmId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Paramètres</h1>
        <p className="text-sm text-muted">{tenant.crmName}</p>
      </div>

      <SettingsTabs
        crmId={tenant.crmId}
        crmSlug={crmSlug}
        company={{
          legalName: companySettings?.legalName ?? "",
          logoUrl: companySettings?.logoUrl ?? "",
          address: companySettings?.address ?? "",
          postalCode: companySettings?.postalCode ?? "",
          city: companySettings?.city ?? "",
          siret: companySettings?.siret ?? "",
          phone: companySettings?.phone ?? "",
          email: companySettings?.email ?? "",
          website: companySettings?.website ?? "",
          legalMentions: companySettings?.legalMentions ?? "",
          ape: companySettings?.ape ?? "",
          urssafOffice: companySettings?.urssafOffice ?? "",
          legalRepresentative: companySettings?.legalRepresentative ?? "",
          missionOrderLegalMentions: companySettings?.missionOrderLegalMentions ?? "",
        }}
        pointage={pointageSettings}
      />
    </div>
  );
}
