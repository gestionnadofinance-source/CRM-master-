"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CrmTopbar } from "@/components/crm-topbar";
import { CrmSidebar } from "@/components/crm-sidebar";
import type { CrmOption } from "@/components/crm-switcher";
import type { SessionUser } from "@/server/auth/session";
import type {AccessCategory} from "@prisma/client";

/**
 * Coquille de l'espace CRM (topbar + navigation + contenu), déclinée pour
 * mobile : sous md, la navigation devient un tiroir plein écran ouvert via
 * le bouton menu de la topbar au lieu d'être affichée en permanence — il
 * n'y a simplement pas la place pour une colonne fixe sur un téléphone.
 */
export function CrmShell({
  user,
  current,
  options,
  crmSlug,
  category,
  isGlobalAdmin,
  isForeman,
  children,
}: {
  user: SessionUser;
  current: CrmOption;
  options: CrmOption[];
  crmSlug: string;
  category: AccessCategory;
  isGlobalAdmin: boolean;
  isForeman: boolean;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const sidebar = (
    <CrmSidebar
      crmSlug={crmSlug}
      category={category}
      isGlobalAdmin={isGlobalAdmin}
      isForeman={isForeman}
      onNavigate={() => setNavOpen(false)}
    />
  );

  return (
    <div className="flex h-screen flex-col">
      <CrmTopbar
        user={user}
        current={current}
        options={options}
        onMenuClick={() => setNavOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-surface md:block">{sidebar}</div>

        {navOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} aria-hidden="true" />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-surface shadow-xl">
              <div className="flex h-14 shrink-0 items-center justify-end border-b border-border px-3">
                <button
                  onClick={() => setNavOpen(false)}
                  aria-label="Fermer le menu"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-text"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {sidebar}
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto bg-bg-subtle">{children}</main>
      </div>
    </div>
  );
}
