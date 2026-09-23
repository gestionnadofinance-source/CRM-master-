"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CompanySection, type CompanySettingsData } from "./sections/company-section";
import { PointageSection, type PointageSettingsData } from "./sections/pointage-section";

const TABS = ["Informations entreprise", "Pointage"] as const;

type Tab = (typeof TABS)[number];

export function SettingsTabs({
  crmId,
  crmSlug,
  company,
  pointage,
}: {
  crmId: string;
  crmSlug: string;
  company: CompanySettingsData;
  pointage: PointageSettingsData;
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
      {tab === "Pointage" && <PointageSection crmId={crmId} initial={pointage} />}
    </div>
  );
}
