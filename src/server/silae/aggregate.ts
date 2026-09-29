import "server-only";
import { computePointageTotals, type PointageDay } from "@/server/pointage/calc";
import { isFrenchHoliday } from "@/server/silae/holidays";
import { splitWeeklyOvertime } from "@/server/silae/overtime";

/**
 * Agrégation mensuelle des pointages, par salarié et par rubrique.
 *
 * Deux principes, qui sont la raison d'être de ce module :
 *
 * 1. TOUT est recalculé depuis les pointages journaliers. Aucune valeur ne
 *    provient d'un total saisi ailleurs — c'est précisément le défaut du
 *    classeur Excel historique, où certains sous-totaux étaient tapés en dur
 *    (39 h sur une semaine sans une seule heure saisie, y compris pour des
 *    salariés entrés en cours de mois).
 *
 * 2. Une semaine de pointage peut chevaucher deux mois. La règle de
 *    répartition est explicite :
 *      - ce qui est journalier (heures, repas, km, trajet) est réparti
 *        jour par jour ; seuls les jours DU MOIS comptent ;
 *      - ce qui est forfaitaire à la semaine (primes masque, management,
 *        zone, poste, habillage, logement, salissure) et les heures
 *        supplémentaires — légalement hebdomadaires — vont au mois qui
 *        contient la MAJORITÉ des jours travaillés de la semaine, à
 *        égalité le mois le plus ancien.
 *
 * Les montants journaliers ne sont pas recalculés à la main : on appelle le
 * moteur existant (computePointageTotals) sur la semaine entière, puis on
 * proratise au nombre de jours travaillés dans le mois. Ces montants valant
 * tous « jours travaillés × taux », le prorata est exact, et aucune formule
 * n'est dupliquée — donc rien ne peut diverger du calcul affiché à l'écran.
 */

export interface AggregationWeekInput {
  weekStart: Date;
  /**
   * Chantier de la semaine. Indispensable pour les frais rattachés à
   * l'AFFECTATION (frais SNCF, retenue de chambre) : ils ne doivent être
   * comptés qu'une fois par chantier, mais bien une fois PAR chantier.
   */
  chantierId: string;
  days: PointageDay[];
  hourlyRate: number;
  nightRatePercent: number;
  housingAllowance: number;
  dirtAllowance: number;
  gdDepl53Count: number;
  gdDepl80Count: number;
  chantierAmounts: Parameters<typeof computePointageTotals>[3];
  assignmentRates: Parameters<typeof computePointageTotals>[4];
  applied: Parameters<typeof computePointageTotals>[5];
  /** Frais rattachés à l'affectation, non à la semaine : comptés une seule fois. */
  sncfExpense: number;
  roomDeduction: number;
}

export type RubriqueTotals = Record<string, number>;

export interface WeekAnomaly {
  weekStart: Date;
  kind: "heures_hebdo_excessives" | "valeur_negative" | "dimanche_ferie";
  detail: string;
}

/** Voir SundayHolidayRule dans prisma/schema.prisma. */
export type SundayHolidayRule = "CUMUL" | "FERIE_PRIORITAIRE" | "DIMANCHE_PRIORITAIRE";

export interface EmployeeAggregation {
  totals: RubriqueTotals;
  anomalies: WeekAnomaly[];
  /** Nombre d'heures travaillées du mois, utile au récapitulatif de contrôle. */
  monthHours: number;
}

const MAX_REASONABLE_WEEKLY_HOURS = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayHours = (d: PointageDay) => (d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0) + (d.nuit || 0);

function add(totals: RubriqueTotals, key: string, value: number): void {
  if (!value) return;
  totals[key] = round2((totals[key] ?? 0) + value);
}

/**
 * Mois (année, mois 1-12) auquel rattacher les éléments hebdomadaires :
 * celui qui porte le plus de jours travaillés de la semaine. À égalité, le
 * plus ancien — un départage arbitraire mais STABLE, pour qu'une même
 * semaine ne bascule pas d'un mois à l'autre entre deux générations.
 */
export function owningMonth(days: PointageDay[]): { year: number; month: number } | null {
  const counts = new Map<string, number>();
  for (const d of days) {
    if (dayHours(d) <= 0) continue;
    const key = d.date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
  const [year, month] = best[0].split("-").map(Number);
  return { year: year!, month: month! };
}

/**
 * Agrège les semaines d'UN salarié sur UN mois de paie.
 *
 * `weeks` peut contenir des semaines débordant du mois : le tri est fait
 * ici, jamais par l'appelant, pour que la règle de répartition vive en un
 * seul endroit.
 */
export function aggregateEmployeeMonth(
  weeks: AggregationWeekInput[],
  year: number,
  month: number,
  options: { exportWorkedHours?: boolean; sundayHolidayRule?: SundayHolidayRule } = {}
): EmployeeAggregation {
  // Par défaut, le férié l'emporte : c'est le seul choix qui ne risque pas de
  // faire appliquer DEUX majorations à la même heure sans que personne ne le
  // demande. Le cumul reste possible, mais il doit être choisi.
  const regleDimancheFerie = options.sundayHolidayRule ?? "FERIE_PRIORITAIRE";
  const totals: RubriqueTotals = {};
  const anomalies: WeekAnomaly[] = [];
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  let monthHours = 0;
  // Frais d'affectation retenus, PAR CHANTIER : une fois par chantier, jamais
  // une fois par semaine (ils seraient multipliés) ni une fois pour le mois
  // entier (les chantiers suivants seraient perdus).
  const assignmentExpenses = new Map<string, { sncf: number; room: number }>();

  for (const week of weeks) {
    const inMonth = week.days.filter((d) => d.date.startsWith(monthPrefix));
    const weekTotals = computePointageTotals(
      week.days,
      { hourlyRate: week.hourlyRate, nightRatePercent: week.nightRatePercent },
      { housingAllowance: week.housingAllowance, dirtAllowance: week.dirtAllowance },
      week.chantierAmounts,
      week.assignmentRates,
      week.applied
    );

    const workedInMonth = inMonth.filter((d) => dayHours(d) > 0).length;
    const workedTotal = weekTotals.daysWorked;

    // --- Anomalies, relevées sur la semaine entière -------------------
    if (weekTotals.totalHours > MAX_REASONABLE_WEEKLY_HOURS) {
      anomalies.push({
        weekStart: week.weekStart,
        kind: "heures_hebdo_excessives",
        detail: `${round2(weekTotals.totalHours)} h saisies sur la semaine`,
      });
    }
    for (const d of week.days) {
      for (const [label, v] of [["normal", d.normal], ["matin", d.matin], ["après-midi", d.apresMidi], ["nuit", d.nuit]] as const) {
        if ((v ?? 0) < 0) {
          anomalies.push({ weekStart: week.weekStart, kind: "valeur_negative", detail: `${d.date} : ${label} = ${v}` });
        }
      }
    }

    // --- Part journalière : seuls les jours du mois comptent ----------
    for (const d of inMonth) {
      const h = dayHours(d);
      if (h <= 0) continue;
      monthHours = round2(monthHours + h);
      const date = new Date(`${d.date}T00:00:00Z`);
      if (options.exportWorkedHours) add(totals, "heuresTravaillees", h);
      if (d.nuit > 0) add(totals, "heuresNuit", d.nuit);

      const estDimanche = date.getUTCDay() === 0;
      const estFerie = isFrenchHoliday(d.date);
      if (estDimanche && estFerie) {
        // Un jour à la fois dimanche et férié : alimenter les deux rubriques
        // ferait appliquer deux majorations à la même heure. La règle vient
        // du paramétrage de l'espace, et le cas est signalé quoi qu'il
        // arrive — y compris en cumul, qui doit rester un choix conscient.
        if (regleDimancheFerie !== "FERIE_PRIORITAIRE") add(totals, "heuresDimanche", h);
        if (regleDimancheFerie !== "DIMANCHE_PRIORITAIRE") add(totals, "heuresFerie", h);
        anomalies.push({
          weekStart: week.weekStart,
          kind: "dimanche_ferie",
          detail: `${d.date} : ${round2(h)} h travaillées un dimanche férié (règle appliquée : ${regleDimancheFerie})`,
        });
      } else {
        if (estDimanche) add(totals, "heuresDimanche", h);
        if (estFerie) add(totals, "heuresFerie", h);
      }
    }

    // Montants « jours travaillés × taux » : prorata exact.
    if (workedTotal > 0 && workedInMonth > 0) {
      const ratio = workedInMonth / workedTotal;
      add(totals, "indemniteKm", round2(weekTotals.kmTotal * ratio));
      add(totals, "indemniteTrajet", round2(weekTotals.travelTotal * ratio));
      add(totals, "remboursementTrajet", round2(weekTotals.travelHoursTotal * ratio));
      // Repas et paniers : un NOMBRE, pas un montant — Silae applique le
      // barème. On compte les jours travaillés du mois quand la case est
      // cochée, et non le montant calculé par le moteur.
      if (week.applied.lunchAllowanceApplied) add(totals, "repasMidi", workedInMonth);
      if (week.applied.dinnerAllowanceApplied) add(totals, "repasSoir", workedInMonth);
      if (week.applied.mealAllowanceApplied) add(totals, "panier", workedInMonth);
    }

    // --- Part hebdomadaire : tout ou rien, au mois majoritaire --------
    const owner = owningMonth(week.days);
    if (owner && owner.year === year && owner.month === month) {
      const { hs25, hs50 } = splitWeeklyOvertime(weekTotals.totalHours);
      add(totals, "hs25", hs25);
      add(totals, "hs50", hs50);
      add(totals, "primeMasque", weekTotals.maskTotal);
      add(totals, "primeManagement", weekTotals.managementTotal);
      add(totals, "primeZone", weekTotals.zoneTotal);
      add(totals, "primePoste", weekTotals.postTotal);
      add(totals, "primeHabillage", weekTotals.clothingTotal);
      add(totals, "logement", week.housingAllowance);
      add(totals, "primeSalissure", week.dirtAllowance);
      add(totals, "grandDeplacement53", week.gdDepl53Count);
      add(totals, "grandDeplacement80", week.gdDepl80Count);
      // Frais rattachés à l'AFFECTATION et non à la semaine : retenus une
      // seule fois par chantier, sinon ils seraient multipliés par le nombre
      // de semaines pointées sur ce chantier.
      const previous = assignmentExpenses.get(week.chantierId) ?? { sncf: 0, room: 0 };
      assignmentExpenses.set(week.chantierId, {
        sncf: Math.max(previous.sncf, week.sncfExpense),
        room: Math.max(previous.room, week.roomDeduction),
      });
    }
  }

  // Puis additionnés entre chantiers : un salarié envoyé sur deux chantiers
  // dans le mois a droit aux frais des deux.
  let sncfTotal = 0;
  let roomTotal = 0;
  for (const { sncf, room } of assignmentExpenses.values()) {
    sncfTotal += sncf;
    roomTotal += room;
  }
  add(totals, "fraisSncf", round2(sncfTotal));
  add(totals, "retenueChambre", round2(roomTotal));

  return { totals, anomalies, monthHours };
}
