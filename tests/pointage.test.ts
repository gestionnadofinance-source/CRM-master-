/**
 * Calcul des feuilles de pointage (heures de nuit + indemnités + primes) —
 * logique pure partagée entre la saisie (pointage-salaries-client.tsx),
 * les server actions et la génération PDF. Aucune dépendance DB : ces tests
 * verrouillent la formule elle-même.
 */
import { describe, expect, it } from "vitest";
import {
  computePointageTotals,
  mondayOf,
  buildEmptyWeek,
  activeIndemnityKeys,
  activePrimeLines,
  mealDates,
  type PointageDay,
} from "@/server/pointage/calc";

const RATES = { hourlyRate: 8, nightRatePercent: 25 }; // majoration nuit = 8 x 25% = 2€/h
const NO_PRIMES = { housingAllowance: 0, dirtAllowanceApplied: false, lunchCount: null, dinnerCount: null };
const CHANTIER_AMOUNTS = {
  lunchAllowance: 20,
  dinnerAllowance: 20,
  travelAllowance: 50,
  maskBonus: 1,
  zoneBonus: 2,
  postBonus: 4,
  mealAllowance: 9.81,
};
const ZERO_CHANTIER_AMOUNTS = {
  lunchAllowance: 0,
  dinnerAllowance: 0,
  travelAllowance: 0,
  maskBonus: 0,
  zoneBonus: 0,
  postBonus: 0,
  mealAllowance: 0,
};
const ASSIGNMENT_RATES = { kmRate: 0.5, distanceKm: 100, travelHourlyRate: 15, travelDurationHours: 2 };
const NONE_APPLIED = {
  lunchAllowanceApplied: false,
  dinnerAllowanceApplied: false,
  travelAllowanceApplied: false,
  maskBonusApplied: false,
  managementBonusApplied: false,
  zoneBonusApplied: false,
  postBonusApplied: false,
  kmReimbursementApplied: false,
  travelHoursReimbursementApplied: false,
  mealAllowanceApplied: false,
  clothingBonusApplied: false,
};
const ALL_APPLIED = {
  lunchAllowanceApplied: true,
  dinnerAllowanceApplied: true,
  travelAllowanceApplied: true,
  maskBonusApplied: true,
  managementBonusApplied: true,
  zoneBonusApplied: true,
  postBonusApplied: true,
  kmReimbursementApplied: true,
  travelHoursReimbursementApplied: true,
  mealAllowanceApplied: true,
  clothingBonusApplied: true,
};

function emptyDays(): PointageDay[] {
  return buildEmptyWeek(mondayOf(new Date("2026-08-17T00:00:00Z")));
}

describe("computePointageTotals", () => {
  it("returns all zeros for an untouched week", () => {
    const totals = computePointageTotals(emptyDays(), RATES, NO_PRIMES, ZERO_CHANTIER_AMOUNTS, ASSIGNMENT_RATES, NONE_APPLIED);
    expect(totals.totalHours).toBe(0);
    expect(totals.daysWorked).toBe(0);
    expect(totals.grandTotal).toBe(0);
  });

  it("counts a day as worked as soon as any hour category is non-zero, and applies checked indemnities per day worked only", () => {
    const days = emptyDays();
    days[0]!.normal = 7; // lundi travaillé
    days[2]!.nuit = 4; // mercredi travaillé (nuit uniquement)
    const totals = computePointageTotals(days, RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      lunchAllowanceApplied: true,
      dinnerAllowanceApplied: true,
      travelAllowanceApplied: true,
    });
    expect(totals.daysWorked).toBe(2);
    expect(totals.lunchTotal).toBe(40); // 2 jours x 20€
    expect(totals.dinnerTotal).toBe(40);
    expect(totals.travelTotal).toBe(100); // 2 jours x 50€
    expect(totals.totalNuit).toBe(4);
    expect(totals.nightBonusAmount).toBe(8); // 4h x 2€
  });

  it("computes km and travel-hours reimbursements as amount x days worked, only when checked", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    days[1]!.normal = 8; // 2 jours travaillés
    const totals = computePointageTotals(days, RATES, NO_PRIMES, ZERO_CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      kmReimbursementApplied: true,
      travelHoursReimbursementApplied: true,
    });
    expect(totals.kmTotal).toBe(100); // 2 jours x 100km x 0.5€
    expect(totals.travelHoursTotal).toBe(60); // 2 jours x 2h x 15€
  });

  it("compte masque/zone/poste/management PAR JOUR travaillé, et l'habillage en unité hebdomadaire", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    days[1]!.normal = 8;
    days[2]!.normal = 8; // 3 jours travaillés
    const totals = computePointageTotals(days, RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, ALL_APPLIED);
    // Journalières : montant × 3 jours.
    expect(totals.maskTotal).toBe(3); // 1 × 3
    expect(totals.zoneTotal).toBe(6); // 2 × 3
    expect(totals.postTotal).toBe(12); // 4 × 3
    // Management : 50 % du taux horaire (8 €) par jour, soit 4 € × 3 jours.
    expect(totals.managementTotal).toBe(12);
    // Habillage : une UNITÉ par semaine, jamais des euros.
    expect(totals.clothingUnits).toBe(1);
  });

  it("management : 50 % du taux horaire arrondi au centime, puis multiplié par les jours", () => {
    const days = emptyDays();
    for (let i = 0; i < 5; i++) days[i]!.normal = 7;
    // 12,35 × 50 % = 6,175 → 6,18 par jour ; × 5 = 30,90 (et non 30,88).
    const totals = computePointageTotals(days, { hourlyRate: 12.35, nightRatePercent: 0 }, NO_PRIMES, ZERO_CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      managementBonusApplied: true,
    });
    expect(totals.managementTotal).toBe(30.9);
  });

  it("repas midi / soir : le NOMBRE choisi par le chef de chantier, pas les jours travaillés", () => {
    const days = emptyDays();
    for (let i = 0; i < 5; i++) days[i]!.normal = 7; // 5 jours travaillés
    const totals = computePointageTotals(
      days,
      RATES,
      { ...NO_PRIMES, lunchCount: 3, dinnerCount: 1 },
      CHANTIER_AMOUNTS,
      ASSIGNMENT_RATES,
      { ...NONE_APPLIED, lunchAllowanceApplied: true, dinnerAllowanceApplied: true }
    );
    expect(totals.lunchCount).toBe(3);
    expect(totals.lunchTotal).toBe(60); // 3 × 20
    expect(totals.dinnerCount).toBe(1);
    expect(totals.dinnerTotal).toBe(20);
  });

  it("repas : une fiche antérieure (nombre absent) garde un repas par jour travaillé", () => {
    const days = emptyDays();
    for (let i = 0; i < 4; i++) days[i]!.normal = 7;
    const totals = computePointageTotals(days, RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      lunchAllowanceApplied: true,
    });
    expect(totals.lunchCount).toBe(4);
  });

  it("repas : rattachés aux premiers jours travaillés, jamais à un jour chômé", () => {
    const days = emptyDays(); // lundi 17/08/2026
    days[1]!.normal = 7; // mardi
    days[3]!.normal = 7; // jeudi
    days[4]!.normal = 7; // vendredi
    expect(mealDates(days, 2)).toEqual(["2026-08-18", "2026-08-20"]);
    expect(mealDates(days, null)).toEqual(["2026-08-18", "2026-08-20", "2026-08-21"]);
    expect(mealDates(days, 0)).toEqual([]);
  });

  it("salissure : une unité par semaine cochée, hors des euros", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    const totals = computePointageTotals(days, RATES, { ...NO_PRIMES, dirtAllowanceApplied: true }, ZERO_CHANTIER_AMOUNTS, ASSIGNMENT_RATES, NONE_APPLIED);
    expect(totals.dirtUnits).toBe(1);
    expect(totals.primesTotal).toBe(0);
    expect(totals.grandTotal).toBe(0);
  });

  it("computes the meal allowance (repas) as amount x days worked, only when checked, like lunch/dinner/travel", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    days[1]!.normal = 8; // 2 jours travaillés
    const totals = computePointageTotals(days, RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      mealAllowanceApplied: true,
    });
    expect(totals.mealTotal).toBe(19.62); // 2 jours x 9.81€
  });

  it("additionne en euros logement + primes journalières (habillage et salissure, en unités, en sont exclus), et tout dans grandTotal", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    const primes = { ...NO_PRIMES, housingAllowance: 10, dirtAllowanceApplied: true };
    const totals = computePointageTotals(days, RATES, primes, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, ALL_APPLIED);
    // logement 10 + masque 1 + management 4 (50 % de 8 €) + zone 2 + poste 4
    expect(totals.primesTotal).toBe(10 + 1 + 4 + 2 + 4);
    expect(totals.grandTotal).toBe(
      totals.nightBonusAmount +
        totals.lunchTotal +
        totals.dinnerTotal +
        totals.travelTotal +
        totals.kmTotal +
        totals.travelHoursTotal +
        totals.mealTotal +
        totals.primesTotal
    );
  });

  it("never lets a day worked on Sunday alone slip past the daysWorked count (7-day coverage)", () => {
    const days = emptyDays();
    days[6]!.matin = 3.5;
    const totals = computePointageTotals(days, RATES, NO_PRIMES, ZERO_CHANTIER_AMOUNTS, ASSIGNMENT_RATES, NONE_APPLIED);
    expect(totals.daysWorked).toBe(1);
    expect(totals.totalMatin).toBe(3.5);
  });
});

describe("activeIndemnityKeys / activePrimeLines (rien n'apparaît sur le PDF sans avoir été coché)", () => {
  it("hides every indemnity line when nothing is checked, even with days worked", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    days[1]!.nuit = 3;
    const totals = computePointageTotals(days, { hourlyRate: 8, nightRatePercent: 0 }, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, NONE_APPLIED);
    expect(totals.grandTotal).toBe(0);
    expect(activeIndemnityKeys(totals)).toEqual([]);
  });

  it("shows only the indemnity lines actually checked", () => {
    const days = emptyDays();
    days[0]!.normal = 8; // 1 jour travaillé
    days[0]!.nuit = 2;
    const totals = computePointageTotals(days, { hourlyRate: 12, nightRatePercent: 25 }, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      dinnerAllowanceApplied: true,
    });
    expect(activeIndemnityKeys(totals)).toEqual(["night", "dinner"]);
  });

  it("hides every prime line left at 0/unchecked and keeps only the ones actually due", () => {
    const primes = { ...NO_PRIMES, housingAllowance: 12 };
    const days = emptyDays();
    days[0]!.normal = 8; // 1 jour : la prime masque (journalière) vaut alors 1 × 1
    const totals = computePointageTotals(days, RATES, primes, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      maskBonusApplied: true,
    });
    expect(activePrimeLines(primes, totals)).toEqual([
      { key: "housingAllowance", amount: 12, unit: "eur" },
      { key: "maskBonus", amount: 1, unit: "eur" },
    ]);
  });

  it("returns no active prime line when every prime/bonus is 0 or unchecked", () => {
    const totals = computePointageTotals(emptyDays(), RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, NONE_APPLIED);
    expect(activePrimeLines(NO_PRIMES, totals)).toEqual([]);
  });
});

describe("mondayOf", () => {
  it("is idempotent across every day of the same ISO week", () => {
    const reference = mondayOf(new Date("2026-08-17T00:00:00Z")); // a Monday
    for (let i = 0; i < 7; i++) {
      const d = new Date(reference);
      d.setUTCDate(d.getUTCDate() + i);
      expect(mondayOf(d).toISOString()).toBe(reference.toISOString());
    }
  });

  it("rolls a Sunday back to the Monday that started its week, not forward", () => {
    const sunday = new Date("2026-08-23T12:00:00Z");
    const monday = mondayOf(sunday);
    expect(monday.toISOString().slice(0, 10)).toBe("2026-08-17");
  });
});

describe("buildEmptyWeek", () => {
  it("produces exactly 7 consecutive days starting at weekStart, all hours zeroed", () => {
    const start = mondayOf(new Date("2026-08-17T00:00:00Z"));
    const days = buildEmptyWeek(start);
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-08-17");
    expect(days[6]!.date).toBe("2026-08-23");
    expect(days.every((d) => d.normal === 0 && d.matin === 0 && d.apresMidi === 0 && d.nuit === 0)).toBe(true);
  });
});
