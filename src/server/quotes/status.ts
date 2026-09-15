// Pas de directive "server-only" ici : ce fichier ne contient que des
// constantes pures, importables aussi bien depuis des composants serveur que
// des composants client (badges, libellés, transitions autorisées).
import type { QuoteStatus } from "@prisma/client";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  FOLLOWED_UP: "Relancé",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
  EXPIRED: "Expiré",
};

export const QUOTE_STATUS_BADGE_VARIANT: Record<QuoteStatus, "default" | "success" | "warning" | "danger" | "brand"> = {
  DRAFT: "default",
  SENT: "brand",
  FOLLOWED_UP: "warning",
  ACCEPTED: "success",
  REFUSED: "danger",
  EXPIRED: "default",
};

/** Transitions manuelles autorisées depuis chaque statut (SENT n'est atteignable que via l'action d'envoi dédiée). */
export const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: [],
  SENT: ["FOLLOWED_UP", "ACCEPTED", "REFUSED", "EXPIRED"],
  FOLLOWED_UP: ["ACCEPTED", "REFUSED", "EXPIRED"],
  ACCEPTED: [],
  REFUSED: [],
  EXPIRED: [],
};

export const QUOTE_STATUS_OPTIONS: QuoteStatus[] = ["DRAFT", "SENT", "FOLLOWED_UP", "ACCEPTED", "REFUSED", "EXPIRED"];
