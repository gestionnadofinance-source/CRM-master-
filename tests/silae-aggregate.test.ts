/**
 * Agrégation mensuelle pour l'export Silae.
 *
 * Le cas décisif est la semaine à cheval sur deux mois : le journalier se
 * répartit jour par jour, l'hebdomadaire va au mois majoritaire. Une erreur
 * ici décale des heures ou des primes d'un mois de paie sur l'autre, sans
 * qu'aucun contrôle de Silae ne la signale.
 */
import { describe, expect, it } from "vitest";
import { aggregateEmployeeMonth, owningMonth, type AggregationWeekInput } from "@/server/silae/aggregate";
import type { PointageDay } from "@/server/pointage/calc";

const NO_AMOUNTS = {
  lunchAllowance: 0, dinnerAllowance: 0, travelAllowance: 0, maskBonus: 0,
  managementBonus: 0, zoneBonus: 0, postBonus: 0, mealAllowance: 0, clothingBonus: 0,
};
const NO_TRAVEL = { kmRate: 0, distanceKm: 0, travelHourlyRate: 0, travelDurationHours: 0 };
const NOTHING_APPLIED = {
  lunchAllowanceApplied: false, dinnerAllowanceApplied: false, travelAllowanceApplied: false,
  maskBonusApplied: false, managementBonusApplied: false, zoneBonusApplied: false,
  postBonusApplied: false, kmReimbursementApplied: false, travelHoursReimbursementApplied: false,
  mealAllowanceApplied: false, clothingBonusApplied: false,
};

function days(start: string, hoursPerDay: (number | null)[]): PointageDay[] {
  const base = new Date(`${start}T00:00:00Z`);
  return hoursPerDay.map((h, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: h ?? 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
}

function week(over: Partial<AggregationWeekInput> & { days: PointageDay[]; weekStart: Date }): AggregationWeekInput {
  return {
    hourlyRate: 12, nightRatePercent: 25, housingAllowance: 0, dirtAllowance: 0,
    gdDepl53Count: 0, gdDepl80Count: 0, chantierAmounts: NO_AMOUNTS, assignmentRates: NO_TRAVEL,
    applied: NOTHING_APPLIED, sncfExpense: 0, roomDeduction: 0, ...over,
  };
}

describe("mois de rattachement d'une semaine", () => {
  it("rattache au mois qui porte le plus de jours travaillés", () => {
    // Lundi 28/09 au dimanche 04/10 : 3 jours en septembre, 2 en octobre.
    expect(owningMonth(days("2026-09-28", [7, 7, 7, 7, 7, null, null]))).toEqual({ year: 2026, month: 9 });
    // Même semaine, mais travaillée seulement à partir du jeudi 01/10.
    expect(owningMonth(days("2026-09-28", [null, null, null, 7, 7, null, null]))).toEqual({ year: 2026, month: 10 });
  });

  it("départage une égalité par le mois le plus ancien, de façon stable", () => {
    // 2 jours en septembre (lun 28, mar 29), 2 en octobre (jeu 1, ven 2).
    expect(owningMonth(days("2026-09-28", [7, 7, null, 7, 7, null, null]))).toEqual({ year: 2026, month: 9 });
  });

  it("rend null pour une semaine sans aucune heure", () => {
    expect(owningMonth(days("2026-09-28", [null, null, null, null, null, null, null]))).toBeNull();
  });
});

describe("agrégation d'un mois", () => {
  it("ne retient que les heures du mois demandé sur une semaine à cheval", () => {
    const w = week({ weekStart: new Date("2026-09-28T00:00:00Z"), days: days("2026-09-28", [7, 7, 7, 7, 7, null, null]) });
    const sept = aggregateEmployeeMonth([w], 2026, 9, { exportWorkedHours: true });
    const oct = aggregateEmployeeMonth([w], 2026, 10, { exportWorkedHours: true });

    expect(sept.totals.heuresTravaillees).toBe(21); // lun 28, mar 29, mer 30
    expect(oct.totals.heuresTravaillees).toBe(14); // jeu 1, ven 2
    expect(sept.monthHours + oct.monthHours).toBe(35);
  });

  it("attribue les heures supplémentaires de la semaine à UN seul mois, sans les couper", () => {
    // 42 h sur une semaine à cheval : 7 h supplémentaires, toutes à 25 %.
    const w = week({ weekStart: new Date("2026-09-28T00:00:00Z"), days: days("2026-09-28", [7, 7, 7, 7, 7, 7, null]) });
    const sept = aggregateEmployeeMonth([w], 2026, 9);
    const oct = aggregateEmployeeMonth([w], 2026, 10);

    expect(sept.totals.hs25).toBe(7);
    expect(sept.totals.hs50).toBeUndefined();
    expect(oct.totals.hs25).toBeUndefined();
  });

  it("n'exporte pas les heures travaillées par défaut", () => {
    const w = week({ weekStart: new Date("2026-07-06T00:00:00Z"), days: days("2026-07-06", [7, 7, 7, 7, 7, null, null]) });
    expect(aggregateEmployeeMonth([w], 2026, 7).totals.heuresTravaillees).toBeUndefined();
  });

  it("isole les heures du dimanche et celles d'un jour férié", () => {
    // Semaine du 13/07/2026 : mardi 14 est férié, dimanche 19.
    const w = week({ weekStart: new Date("2026-07-13T00:00:00Z"), days: days("2026-07-13", [7, 8, 7, 7, 7, null, 5]) });
    const r = aggregateEmployeeMonth([w], 2026, 7);
    expect(r.totals.heuresFerie).toBe(8);
    expect(r.totals.heuresDimanche).toBe(5);
  });

  it("compte les repas en NOMBRE de jours, jamais en montant", () => {
    const w = week({
      weekStart: new Date("2026-07-06T00:00:00Z"),
      days: days("2026-07-06", [7, 7, 7, 7, 7, null, null]),
      chantierAmounts: { ...NO_AMOUNTS, lunchAllowance: 20, mealAllowance: 9.81 },
      applied: { ...NOTHING_APPLIED, lunchAllowanceApplied: true, mealAllowanceApplied: true },
    });
    const r = aggregateEmployeeMonth([w], 2026, 7);
    expect(r.totals.repasMidi).toBe(5); // 5 jours, pas 100 €
    expect(r.totals.panier).toBe(5); // 5 paniers, pas 49,05 €
  });

  it("proratise les indemnités journalières d'une semaine à cheval", () => {
    const w = week({
      weekStart: new Date("2026-09-28T00:00:00Z"),
      days: days("2026-09-28", [7, 7, 7, 7, 7, null, null]),
      assignmentRates: { kmRate: 0.5, distanceKm: 40, travelHourlyRate: 0, travelDurationHours: 0 },
      applied: { ...NOTHING_APPLIED, kmReimbursementApplied: true },
    });
    // 5 jours x 40 km x 0,50 € = 100 € sur la semaine ; 3 jours en septembre.
    expect(aggregateEmployeeMonth([w], 2026, 9).totals.indemniteKm).toBe(60);
    expect(aggregateEmployeeMonth([w], 2026, 10).totals.indemniteKm).toBe(40);
  });

  it("ne compte les frais d'affectation qu'une fois, même sur plusieurs semaines", () => {
    const mk = (start: string) =>
      week({ weekStart: new Date(`${start}T00:00:00Z`), days: days(start, [7, 7, 7, 7, 7, null, null]), sncfExpense: 120, roomDeduction: 50 });
    const r = aggregateEmployeeMonth([mk("2026-07-06"), mk("2026-07-13"), mk("2026-07-20")], 2026, 7);
    expect(r.totals.fraisSncf).toBe(120); // et non 360
    expect(r.totals.retenueChambre).toBe(50);
  });

  it("signale une semaine aux heures invraisemblables", () => {
    const w = week({ weekStart: new Date("2026-07-06T00:00:00Z"), days: days("2026-07-06", [12, 12, 12, 12, 12, 12, null]) });
    const r = aggregateEmployeeMonth([w], 2026, 7);
    expect(r.anomalies.map((a) => a.kind)).toContain("heures_hebdo_excessives");
  });

  it("signale une valeur négative", () => {
    const w = week({ weekStart: new Date("2026-07-06T00:00:00Z"), days: days("2026-07-06", [7, -3, 7, 7, 7, null, null]) });
    expect(aggregateEmployeeMonth([w], 2026, 7).anomalies.map((a) => a.kind)).toContain("valeur_negative");
  });

  it("n'invente jamais de total : une semaine vide ne produit rien", () => {
    // Le défaut du classeur Excel : 39 h affichées sans une heure saisie.
    const w = week({ weekStart: new Date("2026-07-06T00:00:00Z"), days: days("2026-07-06", [null, null, null, null, null, null, null]) });
    const r = aggregateEmployeeMonth([w], 2026, 7, { exportWorkedHours: true });
    expect(r.totals).toEqual({});
    expect(r.monthHours).toBe(0);
  });
});
