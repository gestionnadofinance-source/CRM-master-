"use client";

import { useSyncExternalStore } from "react";

/**
 * État d'installation partagé par le menu, le bandeau et la fenêtre d'aide.
 * Alimenté par src/components/pwa/pwa-early-script.tsx.
 */

/** L'événement beforeinstallprompt (non typé par le DOM standard). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

interface PwaGlobal {
  prompt: InstallPromptEvent | null;
  installed: boolean;
}

declare global {
  interface Window {
    __crmPwa?: PwaGlobal;
  }
}

export interface InstallState {
  /** L'application tourne dans sa propre fenêtre (déjà installée et ouverte comme telle). */
  standalone: boolean;
  /** Installée sur cet appareil d'après le navigateur (appinstalled), sans y être ouverte. */
  installedHere: boolean;
  /** Invite native disponible (Chrome, Edge…). */
  canPrompt: boolean;
  /** Bandeau fermé ou installation refusée récemment. */
  bannerDismissed: boolean;
}

const SERVER_STATE: InstallState = { standalone: false, installedHere: false, canPrompt: false, bannerDismissed: true };
let cached: InstallState = SERVER_STATE;

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    nav.standalone === true
  );
}

function readInstalledFlag(): boolean {
  try {
    return localStorage.getItem("crm-pwa-installed") === "1";
  } catch {
    return false;
  }
}

function compute(): InstallState {
  const g = window.__crmPwa;
  const next: InstallState = {
    standalone: isStandalone(),
    // Le navigateur ne réémet beforeinstallprompt que si l'application
    // n'est PAS installée : son arrivée efface l'indicateur.
    installedHere: Boolean(g?.installed) || (readInstalledFlag() && !g?.prompt),
    canPrompt: Boolean(g?.prompt),
    bannerDismissed: bannerDismissedRecently(),
  };
  if (
    next.standalone !== cached.standalone ||
    next.installedHere !== cached.installedHere ||
    next.canPrompt !== cached.canPrompt ||
    next.bannerDismissed !== cached.bannerDismissed
  ) {
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("crm-pwa-change", onChange);
  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener("crm-pwa-change", onChange);
    mq?.removeEventListener?.("change", onChange);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, compute, () => SERVER_STATE);
}

/**
 * Affiche l'invite native et rend le choix de l'utilisateur. À appeler
 * directement depuis un clic : le navigateur exige un geste de l'utilisateur.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const g = window.__crmPwa;
  const event = g?.prompt;
  if (!event) return "unavailable";
  // Une invite ne sert qu'une fois.
  g.prompt = null;
  window.dispatchEvent(new Event("crm-pwa-change"));
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

// --- Ouverture de la fenêtre d'aide depuis n'importe quel bouton -------------
const OPEN_EVENT = "crm-pwa-open-help";
export function openInstallHelp(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
export function onOpenInstallHelp(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

// --- Lancer l'installation depuis un clic ------------------------------------
export type InstallNotice = "accepted" | "dismissed" | "installed";
const NOTICE_EVENT = "crm-pwa-notice";

function notify(notice: InstallNotice): void {
  window.dispatchEvent(new CustomEvent<InstallNotice>(NOTICE_EVENT, { detail: notice }));
}
export function onInstallNotice(handler: (n: InstallNotice) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<InstallNotice>).detail);
  window.addEventListener(NOTICE_EVENT, listener);
  // L'installation réelle est confirmée par le navigateur (appinstalled).
  const installed = () => handler("installed");
  window.addEventListener("appinstalled", installed);
  return () => {
    window.removeEventListener(NOTICE_EVENT, listener);
    window.removeEventListener("appinstalled", installed);
  };
}

const BANNER_KEY = "crm-pwa-banner-dismissed-at";
/** Après un refus ou une fermeture, le bandeau ne revient pas avant ce délai. */
export const BANNER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export function bannerDismissedRecently(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(BANNER_KEY));
    return Number.isFinite(at) && at > 0 && now - at < BANNER_SNOOZE_MS;
  } catch {
    return false;
  }
}
export function dismissBanner(): void {
  try {
    localStorage.setItem(BANNER_KEY, String(Date.now()));
  } catch {
    // stockage indisponible (navigation privée) : le bandeau reviendra, sans gravité
  }
  window.dispatchEvent(new Event("crm-pwa-change"));
}

/**
 * Le bouton « Télécharger l'application » : invite native si le navigateur
 * en fournit une, sinon fenêtre d'aide adaptée à l'appareil. Doit être appelé
 * directement dans le gestionnaire du clic.
 */
export function startInstall(): void {
  if (!window.__crmPwa?.prompt) {
    openInstallHelp();
    return;
  }
  void promptInstall().then((outcome) => {
    if (outcome === "accepted") notify("accepted");
    else if (outcome === "dismissed") {
      // Refus : on ne relance pas la proposition, le bouton du menu reste.
      dismissBanner();
      notify("dismissed");
    } else openInstallHelp();
  });
}
