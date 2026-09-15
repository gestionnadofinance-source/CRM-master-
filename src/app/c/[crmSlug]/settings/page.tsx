import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { getPointageSettings } from "@/server/pointage/actions";
import { AutomationRulesPanel } from "@/components/automations/automation-rules-panel";
import { SettingsTabs } from "./settings-tabs";

export default async function CrmSettingsPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_SETTINGS);

  const [companySettings, stages, sources, tags, customFields, vatRates, bookingSettings, quoteTemplates, emailTemplates, pointageSettings] =
    await Promise.all([
      prisma.companySettings.findUnique({ where: { crmId: tenant.crmId } }),
      prisma.pipelineStage.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
      prisma.source.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
      prisma.tag.findMany({ where: { crmId: tenant.crmId }, orderBy: { name: "asc" } }),
      prisma.customFieldDefinition.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
      prisma.vatRate.findMany({ where: { crmId: tenant.crmId }, orderBy: { rate: "desc" } }),
      prisma.bookingSettings.findUnique({ where: { crmId: tenant.crmId } }),
      prisma.quoteTemplate.findMany({ where: { crmId: tenant.crmId }, orderBy: { createdAt: "asc" } }),
      prisma.emailTemplate.findMany({ where: { crmId: tenant.crmId }, orderBy: { name: "asc" } }),
      getPointageSettings(tenant.crmId),
    ]);

  const env = getServerEnv();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Paramètres du CRM</h1>
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
        stages={stages.map((s) => ({ id: s.id, name: s.name, order: s.order, color: s.color, isWon: s.isWon, isLost: s.isLost }))}
        sources={sources.map((s) => ({ id: s.id, name: s.name, order: s.order }))}
        tags={tags.map((t) => ({ id: t.id, name: t.name, scope: t.scope, color: t.color }))}
        customFields={customFields.map((f) => ({
          id: f.id,
          entityType: f.entityType,
          label: f.label,
          fieldType: f.fieldType,
          options: f.options,
          required: f.required,
          order: f.order,
        }))}
        vatRates={vatRates.map((v) => ({ id: v.id, label: v.label, rate: v.rate.toString(), isDefault: v.isDefault }))}
        booking={{
          isEnabled: bookingSettings?.isEnabled ?? true,
          slotDurationMinutes: bookingSettings?.slotDurationMinutes ?? 30,
          bufferMinutes: bookingSettings?.bufferMinutes ?? 0,
          minNoticeHours: bookingSettings?.minNoticeHours ?? 24,
          maxAdvanceDays: bookingSettings?.maxAdvanceDays ?? 60,
          balancedDistribution: bookingSettings?.balancedDistribution ?? false,
          introMessage: bookingSettings?.introMessage ?? "",
          publicUrl: bookingSettings ? `${env.APP_URL}/book/${bookingSettings.publicSlug}` : "",
        }}
        quoteTemplates={quoteTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          logoUrl: t.logoUrl,
          primaryColor: t.primaryColor,
          mentions: t.mentions,
          conditions: t.conditions,
          footer: t.footer,
          isDefault: t.isDefault,
        }))}
        emailTemplates={emailTemplates.map((t) => ({ id: t.id, key: t.key, name: t.name, subject: t.subject, body: t.body }))}
        pointage={pointageSettings}
        automationPanel={<AutomationRulesPanel crmId={tenant.crmId} />}
      />
    </div>
  );
}
