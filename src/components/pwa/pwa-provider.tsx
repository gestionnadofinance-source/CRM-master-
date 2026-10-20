"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Enregistre le service worker (src/app/sw.js/route.ts), signale les
 * nouvelles versions et la perte de connexion. Monté une fois, dans le
 * layout racine.
 *
 * Nouvelle version : un message propose « Recharger » ; rien n'est rechargé
 * sans ce clic, pour ne jamais interrompre une saisie en cours. Les pages
 * n'étant jamais servies depuis un cache, ignorer le message ne bloque
 * personne sur une ancienne version des données.
 */
function subscribeConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function PwaProvider() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const offline = useSyncExternalStore(subscribeConnectivity, () => !navigator.onLine, () => false);
  const reloading = useRef(false);

  useEffect(() => {
    // En développement, un service worker garderait des fichiers périmés.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;

    const watch = (reg: ServiceWorkerRegistration) => {
      // Une version attend déjà (installée lors d'une visite précédente).
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        incoming?.addEventListener("statechange", () => {
          // Pas de message à la toute première installation : rien à mettre à jour.
          if (incoming.state === "installed" && navigator.serviceWorker.controller) setWaiting(incoming);
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        watch(reg);
      })
      .catch((err) => console.warn("[pwa] service worker non enregistré", err));

    // Vérifie s'il existe une nouvelle version quand on revient sur l'application.
    const check = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", check);
    const interval = setInterval(check, 60 * 60 * 1000);

    const onControllerChange = () => {
      if (!reloading.current) return; // seulement après le clic sur « Recharger »
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      document.removeEventListener("visibilitychange", check);
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  function applyUpdate() {
    if (!waiting) return;
    reloading.current = true;
    waiting.postMessage("SKIP_WAITING");
  }

  return (
    <>
      {offline && (
        // Sous la barre du haut (h-14), pour ne masquer ni le menu ni la navigation.
        <div
          role="status"
          className="fixed left-1/2 top-16 z-[60] flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-black shadow-lg"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Hors connexion : les informations affichées peuvent ne plus être à jour, et rien ne peut être enregistré
          tant que la connexion n&apos;est pas revenue.
        </div>
      )}
      {waiting && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm text-text shadow-lg sm:inset-x-auto sm:left-4 sm:bottom-4 sm:max-w-md"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <RefreshCw className="h-4 w-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            Une nouvelle version de CRM Master est disponible. Enregistrez votre saisie en cours, puis rechargez.
          </span>
          <Button size="sm" onClick={applyUpdate}>
            Recharger
          </Button>
        </div>
      )}
    </>
  );
}
