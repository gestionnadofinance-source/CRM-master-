import "server-only";

/**
 * Barème de score prospect — transparent et facile à ajuster : chaque
 * critère est une constante nommée, et `computeProspectScore` renvoie à la
 * fois le total (0-100, borné) et le détail ligne par ligne pour affichage
 * sur la fiche prospect (rien n'est jamais opaque pour l'utilisateur).
 */

export const SCORE_APPOINTMENT_TAKEN = 20;
export const SCORE_QUOTE_MADE = 25;
export const SCORE_RECENT_INTERACTION_MAX = 10;
export const SCORE_RECENT_INTERACTION_WINDOW_DAYS = 7;
export const SCORE_RECENT_INTERACTION_DECAY_DAYS = 30; // au-delà, la composante retombe à 0

/** Poids additionnel par source (nom exact du Source.name du CRM). Sources absentes = 0. */
export const SOURCE_SCORE_WEIGHTS: Record<string, number> = {
  Recommandation: 15,
  "Ancien client": 12,
  "Site internet": 8,
  Salon: 8,
  Téléphone: 5,
  Email: 5,
  Prospection: 3,
  "Réseaux sociaux": 3,
  Publicité: 3,
};

/** Points selon le montant potentiel estimé (paliers). */
export const POTENTIAL_AMOUNT_TIERS: { min: number; points: number }[] = [
  { min: 20000, points: 15 },
  { min: 5000, points: 10 },
  { min: 1000, points: 5 },
  { min: 0, points: 0 },
];

export interface ScoreBreakdownLine {
  label: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdownLine[];
}

export interface ComputeScoreInput {
  sourceName?: string | null;
  hasAppointment: boolean;
  hasQuoteOrOpportunity: boolean;
  lastContactAt: Date | null;
  potentialAmount: number | null;
}

function potentialAmountPoints(amount: number | null): number {
  if (amount == null) return 0;
  for (const tier of POTENTIAL_AMOUNT_TIERS) {
    if (amount >= tier.min) return tier.points;
  }
  return 0;
}

function recencyPoints(lastContactAt: Date | null): number {
  if (!lastContactAt) return 0;
  const days = (Date.now() - lastContactAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= SCORE_RECENT_INTERACTION_WINDOW_DAYS) return SCORE_RECENT_INTERACTION_MAX;
  if (days >= SCORE_RECENT_INTERACTION_DECAY_DAYS) return 0;
  const ratio = 1 - (days - SCORE_RECENT_INTERACTION_WINDOW_DAYS) / (SCORE_RECENT_INTERACTION_DECAY_DAYS - SCORE_RECENT_INTERACTION_WINDOW_DAYS);
  return Math.round(SCORE_RECENT_INTERACTION_MAX * ratio);
}

export function computeProspectScore(input: ComputeScoreInput): ScoreResult {
  const breakdown: ScoreBreakdownLine[] = [];

  if (input.hasAppointment) {
    breakdown.push({ label: "Rendez-vous pris", points: SCORE_APPOINTMENT_TAKEN });
  }
  if (input.hasQuoteOrOpportunity) {
    breakdown.push({ label: "Devis / opportunité réalisé(e)", points: SCORE_QUOTE_MADE });
  }

  const sourceWeight = input.sourceName ? SOURCE_SCORE_WEIGHTS[input.sourceName] ?? 0 : 0;
  if (sourceWeight > 0) {
    breakdown.push({ label: `Source : ${input.sourceName}`, points: sourceWeight });
  }

  const recency = recencyPoints(input.lastContactAt);
  if (recency > 0) {
    breakdown.push({ label: "Interaction récente", points: recency });
  }

  const potential = potentialAmountPoints(input.potentialAmount);
  if (potential > 0) {
    breakdown.push({ label: "Montant potentiel", points: potential });
  }

  const total = Math.max(0, Math.min(100, breakdown.reduce((sum, l) => sum + l.points, 0)));

  return { score: total, breakdown };
}
