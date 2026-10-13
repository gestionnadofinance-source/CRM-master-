import "server-only";

/**
 * Détail des heures d'un salarié pour un jour donné (catégories reprises
 * du modèle papier Fidem : normal / matin / après-midi / nuit). `date` est
 * une chaîne ISO (yyyy-mm-dd).
 */
export interface PointageDay {
  date: string;
  normal: number;
  matin: number;
  apresMidi: number;
  nuit: number;
}

export const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

/** Majoration nuit = heures de nuit × taux horaire de base × (% de majoration / 100). */
export interface PointageRates {
  hourlyRate: number;
  nightRatePercent: number;
}

/** Saisies propres à la fiche, hors heures et hors cases du chantier. */
export interface PointagePrimes {
  /** Prime de logement de la semaine, en euros (case cochée = montant saisi). */
  housingAllowance: number;
  /** Prime de salissure : une UNITÉ par semaine quand la case est cochée. */
  dirtAllowanceApplied: boolean;
  /**
   * Nombre de repas midi / soir de la semaine, choisi par le chef de chantier.
   * null = fiche antérieure à ce choix : un repas par jour travaillé.
   */
  lunchCount: number | null;
  dinnerCount: number | null;
}

/** Prime de management : 50 % du taux horaire, par jour travaillé. */
export const MANAGEMENT_RATE_OF_HOURLY = 0.5;

/**
 * Montant journalier de la prime de management, arrondi au centime AVANT
 * d'être multiplié par les jours : c'est ce montant que porte chaque ligne de
 * jour du classeur Excel, et l'export Silae doit retomber sur la même somme.
 */
export function managementDailyAmount(hourlyRate: number): number {
  return Math.round(hourlyRate * MANAGEMENT_RATE_OF_HOURLY * 100) / 100;
}

/** Indemnités/primes fixes de CE chantier (voir Chantier), communes à tous les salariés qui y sont mobilisés. */
export interface ChantierFixedAmounts {
  lunchAllowance: number;
  dinnerAllowance: number;
  travelAllowance: number;
  maskBonus: number;
  zoneBonus: number;
  postBonus: number;
  mealAllowance: number;
}

/** Données de trajet propres à CETTE affectation (voir ChantierAssignment). */
export interface AssignmentTravelRates {
  kmRate: number;
  distanceKm: number;
  travelHourlyRate: number;
  travelDurationHours: number;
}

/** Ce que le chef de chantier a coché sur cette fiche. */
export interface PointageAppliedFlags {
  lunchAllowanceApplied: boolean;
  dinnerAllowanceApplied: boolean;
  travelAllowanceApplied: boolean;
  maskBonusApplied: boolean;
  managementBonusApplied: boolean;
  zoneBonusApplied: boolean;
  postBonusApplied: boolean;
  kmReimbursementApplied: boolean;
  travelHoursReimbursementApplied: boolean;
  mealAllowanceApplied: boolean;
  clothingBonusApplied: boolean;
}

export interface PointageTotals {
  totalNormal: number;
  totalMatin: number;
  totalApresMidi: number;
  totalNuit: number;
  totalHours: number;
  daysWorked: number;
  nightBonusAmount: number;
  /** Nombre de repas midi / soir effectivement accordés (0 si case décochée). */
  lunchCount: number;
  dinnerCount: number;
  lunchTotal: number;
  dinnerTotal: number;
  travelTotal: number;
  kmTotal: number;
  travelHoursTotal: number;
  mealTotal: number;
  maskTotal: number;
  managementTotal: number;
  zoneTotal: number;
  postTotal: number;
  /** Habillage et salissure : des UNITÉS (une par semaine cochée), jamais des euros. */
  clothingUnits: number;
  dirtUnits: number;
  /** Primes en euros uniquement. */
  primesTotal: number;
  grandTotal: number;
}

function dayTotal(d: PointageDay): number {
  return (d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0) + (d.nuit || 0);
}

/**
 * Jours auxquels sont rattachés les repas accordés : les `count` premiers
 * jours travaillés de la semaine (tous si `count` est null). Cette
 * répartition est la seule source du nombre de repas — fiche, Excel et
 * Silae — pour qu'une semaine à cheval sur deux mois partage ses repas de
 * la même façon partout.
 */
export function mealDates(days: PointageDay[], count: number | null): string[] {
  const worked = days.filter((d) => dayTotal(d) > 0).map((d) => d.date).sort();
  return count === null ? worked : worked.slice(0, Math.max(0, Math.floor(count)));
}

/**
 * Calcule les totaux d'heures et les frais d'une semaine de pointage.
 * Les indemnités/primes du chantier et les 2 remboursements de trajet ne
 * sont dus que si la case correspondante est cochée (`applied`) — le
 * montant lui-même vient du chantier (`chantierAmounts`) ou de
 * l'affectation (`assignmentRates`), jamais saisi sur la fiche elle-même.
 *
 * Périodicités et unités (règles du gestionnaire) :
 *   - repas midi / soir : le NOMBRE choisi par le chef de chantier ;
 *   - panier, grand déplacement, km, trajet, masque, zone, poste : par jour
 *     travaillé ;
 *   - management : 50 % du taux horaire par jour travaillé ;
 *   - logement : un montant en euros par semaine ;
 *   - habillage, salissure : une unité par semaine.
 */
export function computePointageTotals(
  days: PointageDay[],
  rates: PointageRates,
  primes: PointagePrimes,
  chantierAmounts: ChantierFixedAmounts,
  assignmentRates: AssignmentTravelRates,
  applied: PointageAppliedFlags
): PointageTotals {
  const totalNormal = days.reduce((s, d) => s + (d.normal || 0), 0);
  const totalMatin = days.reduce((s, d) => s + (d.matin || 0), 0);
  const totalApresMidi = days.reduce((s, d) => s + (d.apresMidi || 0), 0);
  const totalNuit = days.reduce((s, d) => s + (d.nuit || 0), 0);
  const daysWorked = days.filter((d) => dayTotal(d) > 0).length;

  const nightBonusAmount = round2(totalNuit * rates.hourlyRate * (rates.nightRatePercent / 100));
  const lunchCount = applied.lunchAllowanceApplied ? mealDates(days, primes.lunchCount).length : 0;
  const dinnerCount = applied.dinnerAllowanceApplied ? mealDates(days, primes.dinnerCount).length : 0;
  const lunchTotal = round2(lunchCount * chantierAmounts.lunchAllowance);
  const dinnerTotal = round2(dinnerCount * chantierAmounts.dinnerAllowance);
  const travelTotal = applied.travelAllowanceApplied ? round2(daysWorked * chantierAmounts.travelAllowance) : 0;
  const kmTotal = applied.kmReimbursementApplied
    ? round2(daysWorked * assignmentRates.distanceKm * assignmentRates.kmRate)
    : 0;
  const travelHoursTotal = applied.travelHoursReimbursementApplied
    ? round2(daysWorked * assignmentRates.travelDurationHours * assignmentRates.travelHourlyRate)
    : 0;
  // Masque, zone et poste sont des primes JOURNALIÈRES : leur montant est dû
  // pour chaque jour travaillé (voir le classeur Fidem, qui les porte sur
  // chaque ligne de jour). Le management aussi, calculé sur le taux horaire.
  const maskTotal = applied.maskBonusApplied ? round2(daysWorked * chantierAmounts.maskBonus) : 0;
  const managementTotal = applied.managementBonusApplied
    ? round2(daysWorked * managementDailyAmount(rates.hourlyRate))
    : 0;
  const zoneTotal = applied.zoneBonusApplied ? round2(daysWorked * chantierAmounts.zoneBonus) : 0;
  const postTotal = applied.postBonusApplied ? round2(daysWorked * chantierAmounts.postBonus) : 0;
  const mealTotal = applied.mealAllowanceApplied ? round2(daysWorked * chantierAmounts.mealAllowance) : 0;
  const clothingUnits = applied.clothingBonusApplied ? 1 : 0;
  const dirtUnits = primes.dirtAllowanceApplied ? 1 : 0;

  const primesTotal = round2(primes.housingAllowance + maskTotal + managementTotal + zoneTotal + postTotal);

  return {
    totalNormal,
    totalMatin,
    totalApresMidi,
    totalNuit,
    totalHours: round2(totalNormal + totalMatin + totalApresMidi + totalNuit),
    daysWorked,
    nightBonusAmount,
    lunchCount,
    dinnerCount,
    lunchTotal,
    dinnerTotal,
    travelTotal,
    kmTotal,
    travelHoursTotal,
    mealTotal,
    maskTotal,
    managementTotal,
    zoneTotal,
    postTotal,
    clothingUnits,
    dirtUnits,
    primesTotal,
    grandTotal: round2(
      nightBonusAmount + lunchTotal + dinnerTotal + travelTotal + kmTotal + travelHoursTotal + mealTotal + primesTotal
    ),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Indemnités effectivement dues (montant strictement positif) — rien
 * d'autre ne doit apparaître sur la fiche PDF.
 */
export function activeIndemnityKeys(
  totals: PointageTotals
): Array<"night" | "lunch" | "dinner" | "travel" | "km" | "travelHours" | "meal"> {
  const keys: Array<"night" | "lunch" | "dinner" | "travel" | "km" | "travelHours" | "meal"> = [];
  if (totals.nightBonusAmount > 0) keys.push("night");
  if (totals.lunchTotal > 0) keys.push("lunch");
  if (totals.dinnerTotal > 0) keys.push("dinner");
  if (totals.travelTotal > 0) keys.push("travel");
  if (totals.kmTotal > 0) keys.push("km");
  if (totals.travelHoursTotal > 0) keys.push("travelHours");
  if (totals.mealTotal > 0) keys.push("meal");
  return keys;
}

export interface PrimeLine {
  key: "housingAllowance" | "dirtAllowance" | "managementBonus" | "zoneBonus" | "maskBonus" | "postBonus" | "clothingBonus";
  /** Montant en euros, ou nombre d'unités selon `unit`. */
  amount: number;
  unit: "eur" | "unite";
}

/** Primes effectivement dues (valeur strictement positive) pour cette fiche. */
export function activePrimeLines(primes: PointagePrimes, totals: PointageTotals): PrimeLine[] {
  const lines: PrimeLine[] = [];
  if (primes.housingAllowance > 0) lines.push({ key: "housingAllowance", amount: primes.housingAllowance, unit: "eur" });
  if (totals.dirtUnits > 0) lines.push({ key: "dirtAllowance", amount: totals.dirtUnits, unit: "unite" });
  if (totals.managementTotal > 0) lines.push({ key: "managementBonus", amount: totals.managementTotal, unit: "eur" });
  if (totals.zoneTotal > 0) lines.push({ key: "zoneBonus", amount: totals.zoneTotal, unit: "eur" });
  if (totals.maskTotal > 0) lines.push({ key: "maskBonus", amount: totals.maskTotal, unit: "eur" });
  if (totals.postTotal > 0) lines.push({ key: "postBonus", amount: totals.postTotal, unit: "eur" });
  if (totals.clothingUnits > 0) lines.push({ key: "clothingBonus", amount: totals.clothingUnits, unit: "unite" });
  return lines;
}

/** Lundi (00:00) de la semaine contenant `date`, en UTC pour éviter toute dérive de fuseau côté stockage. */
export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function buildEmptyWeek(weekStart: Date): PointageDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
}
