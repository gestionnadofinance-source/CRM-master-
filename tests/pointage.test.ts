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
  type PointageDay,
} from "@/server/pointage/calc";

const RATES = { hourlyRate: 8, nightRatePercent: 25 }; // majoration nuit = 8 x 25% = 2€/h
const NO_PRIMES = { housingAllowance: 0, dirtAllowance: 0 };
const CHANTIER_AMOUNTS = {
  lunchAllowance: 20,
  dinnerAllowance: 20,
  travelAllowance: 50,
  maskBonus: 1,
  managementBonus: 3,
  zoneBonus: 2,
  postBonus: 4,
  mealAllowance: 9.81,
  clothingBonus: 6,
};
const ZERO_CHANTIER_AMOUNTS = {
  lunchAllowance: 0,
  dinnerAllowance: 0,
  travelAllowance: 0,
  maskBonus: 0,
  managementBonus: 0,
  zoneBonus: 0,
  postBonus: 0,
  mealAllowance: 0,
  clothingBonus: 0,
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

  it("treats the flat chantier bonuses (mask/management/zone/post/clothing) as per-week amounts, not multiplied by days worked", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    days[1]!.normal = 8;
    days[2]!.normal = 8; // 3 jours travaillés
    const totals = computePointageTotals(days, RATES, NO_PRIMES, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, ALL_APPLIED);
    expect(totals.maskTotal).toBe(1);
    expect(totals.managementTotal).toBe(3);
    expect(totals.zoneTotal).toBe(2);
    expect(totals.postTotal).toBe(4);
    expect(totals.clothingTotal).toBe(6);
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

  it("sums housing/dirt (manual) with the flat chantier bonuses (incl. clothing) into primesTotal, and folds everything (incl. meal) into grandTotal", () => {
    const days = emptyDays();
    days[0]!.normal = 8;
    const primes = { housingAllowance: 10, dirtAllowance: 5 };
    const totals = computePointageTotals(days, RATES, primes, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, ALL_APPLIED);
    expect(totals.primesTotal).toBe(10 + 5 + 1 + 3 + 2 + 4 + 6);
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
    const primes = { housingAllowance: 12, dirtAllowance: 0 };
    const totals = computePointageTotals(emptyDays(), RATES, primes, CHANTIER_AMOUNTS, ASSIGNMENT_RATES, {
      ...NONE_APPLIED,
      maskBonusApplied: true,
    });
    expect(activePrimeLines(primes, totals)).toEqual([
      { key: "housingAllowance", amount: 12 },
      { key: "maskBonus", amount: 1 },
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
