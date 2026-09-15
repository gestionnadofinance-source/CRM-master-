"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { GlobalTopbar } from "@/components/global-topbar";
import { AdminSidebar } from "./admin-sidebar";
import type { SessionUser } from "@/server/auth/session";

/** Même schéma que CrmShell (voir src/app/c/[crmSlug]/crm-shell.tsx) : tiroir plein écran sous md. */
export function AdminShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-screen flex-col">
      <GlobalTopbar user={user} title="Administration" onMenuClick={() => setNavOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-surface md:block">
          <AdminSidebar />
        </div>

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
              <AdminSidebar onNavigate={() => setNavOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto bg-bg-subtle p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
