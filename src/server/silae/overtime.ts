import "server-only";

/**
 * Répartition des heures supplémentaires d'UNE semaine.
 *
 * Règle retenue avec le donneur d'ordre : au-delà de la durée légale
 * hebdomadaire (35 h), les 8 premières heures sont majorées à 25 %, les
 * suivantes à 50 %. C'est ce que désigne la colonne « compteur 8h » du
 * classeur Excel historique.
 *
 * Ce module rend un NOMBRE D'HEURES, jamais un montant : Silae applique
 * lui-même la majoration. L'export Excel historique multipliait, lui, la
 * colonne par 125 % — c'est précisément ce qu'il ne faut pas reproduire.
 *
 * Les seuils sont des paramètres et non des constantes figées : une
 * convention collective peut déplacer le palier.
 */
export const LEGAL_WEEKLY_HOURS = 35;
export const HS25_BAND_HOURS = 8;

export interface OvertimeSplit {
  /** Heures majorées à 25 %. */
  hs25: number;
  /** Heures majorées à 50 %. */
  hs50: number;
}

export function splitWeeklyOvertime(
  weeklyHours: number,
  options: { legalWeeklyHours?: number; band25Hours?: number } = {}
): OvertimeSplit {
  const legal = options.legalWeeklyHours ?? LEGAL_WEEKLY_HOURS;
  const band = options.band25Hours ?? HS25_BAND_HOURS;

  const overtime = Math.max(0, round2(weeklyHours - legal));
  if (overtime === 0) return { hs25: 0, hs50: 0 };

  const hs25 = Math.min(overtime, band);
  return { hs25: round2(hs25), hs50: round2(overtime - hs25) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
