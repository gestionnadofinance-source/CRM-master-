"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CompanySection, type CompanySettingsData } from "./sections/company-section";
import { PipelineSection, type StageRow } from "./sections/pipeline-section";
import { SourcesSection, type SourceRow } from "./sections/sources-section";
import { TagsSection, type TagRow } from "./sections/tags-section";
import { CustomFieldsSection, type CustomFieldRow } from "./sections/custom-fields-section";
import { VatSection, type VatRateRow } from "./sections/vat-section";
import { BookingSection, type BookingSettingsData } from "./sections/booking-section";
import { QuoteTemplatesSection, type QuoteTemplateRow } from "./sections/quote-templates-section";
import { EmailTemplatesSection, type EmailTemplateRow } from "./sections/email-templates-section";
import { PointageSection, type PointageSettingsData } from "./sections/pointage-section";

const TABS = [
  "Informations entreprise",
  "Pipeline",
  "Sources",
  "Tags",
  "Champs personnalisés",
  "Taux de TVA",
  "Réservation",
  "Modèles de devis",
  "Modèles d'emails",
  "Pointage",
  "Automatisations",
] as const;

type Tab = (typeof TABS)[number];

export function SettingsTabs({
  crmId,
  crmSlug,
  company,
  stages,
  sources,
  tags,
  customFields,
  vatRates,
  booking,
  quoteTemplates,
  emailTemplates,
  pointage,
  automationPanel,
}: {
  crmId: string;
  crmSlug: string;
  company: CompanySettingsData;
  stages: StageRow[];
  sources: SourceRow[];
  tags: TagRow[];
  customFields: CustomFieldRow[];
  vatRates: VatRateRow[];
  booking: BookingSettingsData;
  quoteTemplates: QuoteTemplateRow[];
  emailTemplates: EmailTemplateRow[];
  pointage: PointageSettingsData;
  automationPanel: React.ReactNode | null;
}) {
  const [tab, setTab] = useState<Tab>(TABS[0]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium",
              tab === t ? "border-b-2 border-brand text-brand" : "text-muted hover:text-text"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Informations entreprise" && <CompanySection crmId={crmId} crmSlug={crmSlug} initial={company} />}
      {tab === "Pipeline" && <PipelineSection crmId={crmId} crmSlug={crmSlug} stages={stages} />}
      {tab === "Sources" && <SourcesSection crmId={crmId} crmSlug={crmSlug} sources={sources} />}
      {tab === "Tags" && <TagsSection crmId={crmId} crmSlug={crmSlug} tags={tags} />}
      {tab === "Champs personnalisés" && <CustomFieldsSection crmId={crmId} crmSlug={crmSlug} fields={customFields} />}
      {tab === "Taux de TVA" && <VatSection crmId={crmId} crmSlug={crmSlug} rates={vatRates} />}
      {tab === "Réservation" && <BookingSection crmId={crmId} crmSlug={crmSlug} initial={booking} />}
      {tab === "Modèles de devis" && <QuoteTemplatesSection crmId={crmId} crmSlug={crmSlug} templates={quoteTemplates} />}
      {tab === "Modèles d'emails" && <EmailTemplatesSection crmId={crmId} crmSlug={crmSlug} templates={emailTemplates} />}
      {tab === "Pointage" && <PointageSection crmId={crmId} initial={pointage} />}
      {tab === "Automatisations" &&
        (automationPanel ?? <p className="text-sm text-muted">Automatisations : à configurer.</p>)}
    </div>
  );
}
