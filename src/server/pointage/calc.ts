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

export interface PointagePrimes {
  housingAllowance: number;
  dirtAllowance: number;
}

/** Indemnités/primes fixes de CE chantier (voir Chantier), communes à tous les salariés qui y sont mobilisés. */
export interface ChantierFixedAmounts {
  lunchAllowance: number;
  dinnerAllowance: number;
  travelAllowance: number;
  maskBonus: number;
  managementBonus: number;
  zoneBonus: number;
  postBonus: number;
  mealAllowance: number;
  clothingBonus: number;
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
  clothingTotal: number;
  primesTotal: number;
  grandTotal: number;
}

function dayTotal(d: PointageDay): number {
  return (d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0) + (d.nuit || 0);
}

/**
 * Calcule les totaux d'heures et les frais d'une semaine de pointage.
 * Les 9 indemnités/primes du chantier et les 2 remboursements de trajet ne
 * sont dus que si la case correspondante est cochée (`applied`) — le
 * montant lui-même vient du chantier (`chantierAmounts`) ou de
 * l'affectation (`assignmentRates`), jamais saisi sur la fiche elle-même.
 * Les indemnités journalières (repas midi/soir, grand déplacement) comme
 * les remboursements km/trajet sont multipliés par le nombre de jours
 * travaillés dans la semaine ; les primes (masque, management, zone,
 * poste, logement, salissure) sont des montants forfaitaires par semaine.
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
  const lunchTotal = applied.lunchAllowanceApplied ? round2(daysWorked * chantierAmounts.lunchAllowance) : 0;
  const dinnerTotal = applied.dinnerAllowanceApplied ? round2(daysWorked * chantierAmounts.dinnerAllowance) : 0;
  const travelTotal = applied.travelAllowanceApplied ? round2(daysWorked * chantierAmounts.travelAllowance) : 0;
  const kmTotal = applied.kmReimbursementApplied
    ? round2(daysWorked * assignmentRates.distanceKm * assignmentRates.kmRate)
    : 0;
  const travelHoursTotal = applied.travelHoursReimbursementApplied
    ? round2(daysWorked * assignmentRates.travelDurationHours * assignmentRates.travelHourlyRate)
    : 0;
  const maskTotal = applied.maskBonusApplied ? round2(chantierAmounts.maskBonus) : 0;
  const managementTotal = applied.managementBonusApplied ? round2(chantierAmounts.managementBonus) : 0;
  const zoneTotal = applied.zoneBonusApplied ? round2(chantierAmounts.zoneBonus) : 0;
  const postTotal = applied.postBonusApplied ? round2(chantierAmounts.postBonus) : 0;
  const mealTotal = applied.mealAllowanceApplied ? round2(daysWorked * chantierAmounts.mealAllowance) : 0;
  const clothingTotal = applied.clothingBonusApplied ? round2(chantierAmounts.clothingBonus) : 0;

  const primesTotal = round2(
    primes.housingAllowance + primes.dirtAllowance + maskTotal + managementTotal + zoneTotal + postTotal + clothingTotal
  );

  return {
    totalNormal,
    totalMatin,
    totalApresMidi,
    totalNuit,
    totalHours: round2(totalNormal + totalMatin + totalApresMidi + totalNuit),
    daysWorked,
    nightBonusAmount,
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
    clothingTotal,
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
  amount: number;
}

/** Primes effectivement dues (montant strictement positif) pour cette fiche. */
export function activePrimeLines(primes: PointagePrimes, totals: PointageTotals): PrimeLine[] {
  const lines: PrimeLine[] = [];
  if (primes.housingAllowance > 0) lines.push({ key: "housingAllowance", amount: primes.housingAllowance });
  if (primes.dirtAllowance > 0) lines.push({ key: "dirtAllowance", amount: primes.dirtAllowance });
  if (totals.managementTotal > 0) lines.push({ key: "managementBonus", amount: totals.managementTotal });
  if (totals.zoneTotal > 0) lines.push({ key: "zoneBonus", amount: totals.zoneTotal });
  if (totals.maskTotal > 0) lines.push({ key: "maskBonus", amount: totals.maskTotal });
  if (totals.postTotal > 0) lines.push({ key: "postBonus", amount: totals.postTotal });
  if (totals.clothingTotal > 0) lines.push({ key: "clothingBonus", amount: totals.clothingTotal });
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
