import "server-only";
import { getISOWeek } from "date-fns";
import type { Pointage, Chantier, ChantierAssignment } from "@prisma/client";
import { buildAccountingWorkbook, type AccountingWeekInput, type AccountingDay, type AccountingExportInput } from "@/server/accounting/xlsx";

/**
 * Construction du classeur de comptabilité à partir des pointages, isolée
 * ici pour que la production (generateAccountingExport) ET les tests
 * empruntent exactement le même mapping — aucune divergence possible entre
 * ce qui est vérifié et ce qui est livré.
 */

export function toDayArray(value: unknown): AccountingDay[] {
  if (!Array.isArray(value)) return [];
  return value.map((d) => ({
    date: String((d as Record<string, unknown>).date ?? ""),
    normal: Number((d as Record<string, unknown>).normal) || 0,
    matin: Number((d as Record<string, unknown>).matin) || 0,
    apresMidi: Number((d as Record<string, unknown>).apresMidi) || 0,
    nuit: Number((d as Record<string, unknown>).nuit) || 0,
  }));
}

/** Une fiche de pointage → une semaine du classeur. Le montant d'une prime
 * n'est repris que si la case correspondante est cochée ; il vient toujours
 * du chantier (ou de l'affectation pour les km), jamais de la fiche. */
export function pointageToAccountingWeek(
  p: Pointage,
  chantier: Chantier,
  assignment: Pick<ChantierAssignment, "distanceKm" | "kmRate"> | null
): AccountingWeekInput {
  return {
    isoWeek: getISOWeek(p.weekStart),
    days: toDayArray(p.days),
    housingAllowance: Number(p.housingAllowance),
    lunchAllowance: p.lunchAllowanceApplied ? Number(chantier.lunchAllowance) : 0,
    dinnerAllowance: p.dinnerAllowanceApplied ? Number(chantier.dinnerAllowance) : 0,
    mealAllowance: p.mealAllowanceApplied ? Number(chantier.mealAllowance) : 0,
    managementBonus: p.managementBonusApplied ? Number(chantier.managementBonus) : 0,
    clothingBonus: p.clothingBonusApplied ? Number(chantier.clothingBonus) : 0,
    postBonus: p.postBonusApplied ? Number(chantier.postBonus) : 0,
    maskBonus: p.maskBonusApplied ? Number(chantier.maskBonus) : 0,
    zoneBonus: p.zoneBonusApplied ? Number(chantier.zoneBonus) : 0,
    kmPerDay: p.kmReimbursementApplied ? Number(assignment?.distanceKm ?? 0) * Number(assignment?.kmRate ?? 0) : 0,
    travelAllowance: p.travelAllowanceApplied ? Number(chantier.travelAllowance) : 0,
    gdDepl53Count: p.gdDepl53Count,
    gdDepl80Count: p.gdDepl80Count,
  };
}

/** Assemble l'entrée complète de buildAccountingWorkbook pour un salarié sur
 * un chantier. Les fiches sont triées chronologiquement. */
export function buildAccountingInput(
  employeeName: string,
  chantier: Chantier,
  assignment: ChantierAssignment | null,
  pointages: Pointage[]
): AccountingExportInput {
  const weeks = pointages
    .slice()
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map((p) => pointageToAccountingWeek(p, chantier, assignment));
  return {
    employeeName,
    chantierName: chantier.name,
    weeks,
    sncfExpense: Number(assignment?.sncfExpense ?? 0),
    roomDeduction: Number(assignment?.roomDeduction ?? 0),
  };
}

/** Rend le classeur .xlsx d'un salarié pour un chantier (production + tests). */
export async function buildEmployeeAccountingWorkbook(
  employeeName: string,
  chantier: Chantier,
  assignment: ChantierAssignment | null,
  pointages: Pointage[]
): Promise<Buffer> {
  return buildAccountingWorkbook(buildAccountingInput(employeeName, chantier, assignment, pointages));
}
