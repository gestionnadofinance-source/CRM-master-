"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Check, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { canProposeManualInstall, detectPlatform, installHelp, type Platform } from "@/lib/pwa/platform";
import {
  dismissBanner,
  onInstallNotice,
  onOpenInstallHelp,
  startInstall,
  useInstallState,
  type InstallNotice,
} from "@/components/pwa/install-store";

let platformCache: Platform | null = null;
function readPlatform(): Platform {
  platformCache ??= detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  return platformCache;
}
const noSubscription = () => () => undefined;

/** Appareil et navigateur ; null au rendu serveur. */
function usePlatform(): Platform | null {
  return useSyncExternalStore(noSubscription, readPlatform, () => null);
}

/** Entrée « Télécharger l'application » du menu du compte. */
export function InstallMenuItem({ onSelect }: { onSelect: () => void }) {
  const state = useInstallState();
  if (state.standalone) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
        <Check className="h-4 w-4" /> Application installée
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        onSelect();
        startInstall();
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-subtle"
    >
      {state.installedHere ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {state.installedHere ? "Application installée" : "Télécharger l'application"}
    </button>
  );
}

const NOTICES: Record<InstallNotice, string> = {
  accepted: "Installation acceptée : CRM Master s'ajoute à vos applications.",
  installed: "CRM Master est installée sur cet appareil. Vous pouvez la lancer depuis votre écran d'accueil, votre bureau ou votre menu d'applications.",
  dismissed: "Installation annulée. Vous pourrez l'installer plus tard depuis le menu de votre compte (« Télécharger l'application »).",
};

/**
 * Bandeau de première visite, fenêtre d'aide et messages de résultat. Monté
 * une fois par page authentifiée (dans le menu du compte).
 */
export function InstallCenter() {
  const state = useInstallState();
  const platform = usePlatform();
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState<InstallNotice | null>(null);

  useEffect(() => onOpenInstallHelp(() => setHelpOpen(true)), []);
  useEffect(() => onInstallNotice((n) => setNotice(n)), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const proposable = platform !== null && (state.canPrompt || canProposeManualInstall(platform));
  const showBanner = !state.bannerDismissed && !state.standalone && !state.installedHere && proposable && !helpOpen;
  const help = platform ? installHelp(platform) : null;

  return (
    <>
      {showBanner && (
        <div
          role="region"
          aria-label="Installer l'application"
          className="fixed inset-x-3 bottom-3 z-40 rounded-lg border border-border bg-surface p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-brand-fg">
              CM
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">Installer CRM Master sur cet appareil</p>
              <p className="mt-0.5 text-xs text-muted">
                Ouvrez-le comme une application, depuis votre écran d&apos;accueil ou votre bureau.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="whitespace-nowrap" onClick={() => startInstall()}>
                  <Download className="h-3.5 w-3.5" /> Télécharger l&apos;application
                </Button>
                <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={() => dismissBanner()}>
                  Plus tard
                </Button>
              </div>
            </div>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => dismissBanner()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-40 rounded-lg border border-border bg-surface p-3 text-sm text-text shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          {NOTICES[notice]}
        </div>
      )}

      <Modal open={helpOpen && help !== null} onClose={() => setHelpOpen(false)} title="Télécharger l'application" width="sm">
        {help && (
          <div className="space-y-3 text-sm text-text">
            {state.installedHere && (
              <p className="rounded-md border border-border bg-bg-subtle p-2 text-muted">
                CRM Master semble déjà installée sur cet appareil : cherchez son icône sur l&apos;écran d&apos;accueil, le
                bureau ou dans vos applications. Si vous l&apos;avez désinstallée, suivez les étapes ci-dessous.
              </p>
            )}
            <p className="font-medium">{help.title}</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              {help.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {help.note && <p className="text-xs text-muted">{help.note}</p>}
            <p className="text-xs text-muted">
              L&apos;application installée utilise la même adresse et le même compte : elle reste accessible dans le
              navigateur.
            </p>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setHelpOpen(false)}>
                Fermer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
