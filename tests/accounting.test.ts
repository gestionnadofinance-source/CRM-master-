/**
 * Génération du tableau de comptabilité Excel (src/server/accounting/xlsx.ts)
 * à partir de fiches de pointage sélectionnées — reproduit la structure du
 * modèle fourni (bloc "régul", un bloc de 7 jours par semaine, sous-totaux
 * en formules SUM, ligne TOTAL, bloc "note de frais"). Ces tests relisent
 * le classeur généré (via exceljs) pour vérifier le placement des valeurs
 * et des formules — aucune dépendance DB.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildAccountingWorkbook, type AccountingWeekInput } from "@/server/accounting/xlsx";

function emptyWeekDays(mondayIso: string) {
  const start = new Date(`${mondayIso}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
}

const BASE_WEEK: Omit<AccountingWeekInput, "isoWeek" | "days"> = {
  housingAllowance: 0,
  lunchAllowance: 0,
  dinnerAllowance: 0,
  mealAllowance: 0,
  managementBonus: 0,
  clothingBonus: 0,
  postBonus: 0,
  maskBonus: 0,
  zoneBonus: 0,
  kmPerDay: 0,
};

async function readBack(buffer: Awaited<ReturnType<typeof buildAccountingWorkbook>>) {
  const wb = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares an ambient `interface Buffer extends ArrayBuffer {}`
  // (a shim for setups without @types/node) which conflicts with the real Node
  // Buffer type here; @ts-expect-error is a narrowly-scoped, test-only workaround
  // for that upstream typing bug — the runtime call itself is correct (see the
  // passing assertions below, which only work if this actually parses the buffer).
  // @ts-expect-error — see comment above (exceljs Buffer/ArrayBuffer typing clash)
  await wb.xlsx.load(buffer);
  return wb.worksheets[0]!;
}

describe("buildAccountingWorkbook", () => {
  it("titles the sheet with the employee name and reproduces the header row verbatim", async () => {
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    expect(ws.getCell(1, 1).value).toBe("Jean Ouvrier");
    expect(ws.getCell(2, 2).value).toBe("jours");
    expect(ws.getCell(2, 4).value).toBe("chantier");
    expect(ws.getCell(2, 5).value).toBe("heures ");
    expect(ws.getCell(2, 15).value).toBe("repas 9,81");
    expect(ws.getCell(2, 20).value).toBe("prime habillage");
    expect(ws.getCell(2, 23).value).toBe("retenue de chambre");
  });

  it("places daily hours in the heures (E) column on weekdays and in dim (I) on Sunday, and nuit in H", async () => {
    const days = emptyWeekDays("2026-08-17"); // lundi
    days[0]!.normal = 7; // lundi
    days[0]!.nuit = 2;
    days[6]!.normal = 5; // dimanche
    const week: AccountingWeekInput = { ...BASE_WEEK, isoWeek: 34, days };
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [week],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    // Bloc régul = lignes 3-4, sous-total = 5 ; la semaine commence donc en ligne 6 (lundi).
    const weekFirstRow = 6;
    expect(ws.getCell(weekFirstRow, 5).value).toBe(7); // E lundi = heures
    expect(ws.getCell(weekFirstRow, 8).value).toBe(2); // H lundi = nuit
    expect(ws.getCell(weekFirstRow + 6, 9).value).toBe(5); // I dimanche = dim
    expect(ws.getCell(weekFirstRow + 6, 5).value).toBeNull(); // jamais en E le dimanche
  });

  it("places daily-rate allowances (repas, km) only on days actually worked, at the resolved amount", async () => {
    const days = emptyWeekDays("2026-08-17");
    days[0]!.normal = 8;
    days[1]!.normal = 8;
    const week: AccountingWeekInput = {
      ...BASE_WEEK,
      isoWeek: 34,
      days,
      mealAllowance: 9.81,
      kmPerDay: 50, // 100km x 0.5€ déjà résolu par l'appelant
    };
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [week],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    const weekFirstRow = 6;
    expect(ws.getCell(weekFirstRow, 15).value).toBe(9.81); // O lundi
    expect(ws.getCell(weekFirstRow + 1, 15).value).toBe(9.81); // O mardi
    expect(ws.getCell(weekFirstRow + 2, 15).value).toBeNull(); // mercredi non travaillé
    expect(ws.getCell(weekFirstRow, 11).value).toBe(50); // K lundi
  });

  it("places flat weekly bonuses (management/habillage/poste/masque/zone/logement) once, on the first day worked", async () => {
    const days = emptyWeekDays("2026-08-17");
    days[2]!.normal = 8; // mercredi = premier jour travaillé
    const week: AccountingWeekInput = {
      ...BASE_WEEK,
      isoWeek: 34,
      days,
      housingAllowance: 10,
      managementBonus: 3,
      clothingBonus: 15,
      postBonus: 4,
      maskBonus: 1,
      zoneBonus: 2,
    };
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [week],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    const wednesdayRow = 6 + 2;
    expect(ws.getCell(wednesdayRow, 18).value).toBe(10); // R logement
    expect(ws.getCell(wednesdayRow, 19).value).toBe(3); // S management
    expect(ws.getCell(wednesdayRow, 20).value).toBe(15); // T prime habillage
    expect(ws.getCell(wednesdayRow, 21).value).toBe(4); // U poste
    expect(ws.getCell(wednesdayRow, 22).value).toBe(1); // V masque
    expect(ws.getCell(wednesdayRow, 25).value).toBe(2); // Y zone
    // Rien sur le lundi (premier jour du bloc, mais pas travaillé)
    expect(ws.getCell(6, 19).value).toBeNull();
  });

  it("places sncfExpense and roomDeduction exactly once for the whole export, on the first worked day overall", async () => {
    const week1Days = emptyWeekDays("2026-08-17");
    week1Days[0]!.normal = 8;
    const week2Days = emptyWeekDays("2026-08-24");
    week2Days[0]!.normal = 8;
    const weeks: AccountingWeekInput[] = [
      { ...BASE_WEEK, isoWeek: 34, days: week1Days },
      { ...BASE_WEEK, isoWeek: 35, days: week2Days },
    ];
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks,
      sncfExpense: 45.5,
      roomDeduction: 30,
    });
    const ws = await readBack(buffer);
    const firstWeekMondayRow = 6;
    const secondWeekMondayRow = 6 + 8; // 7 jours + 1 sous-total
    expect(ws.getCell(firstWeekMondayRow, 12).value).toBe(45.5); // L frais sncf
    expect(ws.getCell(firstWeekMondayRow, 23).value).toBe(30); // W retenue de chambre
    expect(ws.getCell(secondWeekMondayRow, 12).value).toBeNull();
    expect(ws.getCell(secondWeekMondayRow, 23).value).toBeNull();
  });

  it("writes a SUM formula per week subtotal row and a TOTAL row summing every block, with *125% on compteur 8h (F)", async () => {
    const week1Days = emptyWeekDays("2026-08-17");
    const week2Days = emptyWeekDays("2026-08-24");
    const weeks: AccountingWeekInput[] = [
      { ...BASE_WEEK, isoWeek: 34, days: week1Days },
      { ...BASE_WEEK, isoWeek: 35, days: week2Days },
    ];
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks,
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    // régul(3-4) -> sous-total 5 ; semaine1(6-12) -> sous-total 13 ; semaine2(14-20) -> sous-total 21 ; TOTAL en 22.
    const regulSubtotalRow = 5;
    const week1SubtotalRow = 13;
    const week2SubtotalRow = 21;
    const totalRow = 22;
    expect(ws.getCell(regulSubtotalRow, 5).value).toEqual({ formula: "SUM(E3:E4)" });
    expect(ws.getCell(week1SubtotalRow, 5).value).toEqual({ formula: "SUM(E6:E12)" });
    expect(ws.getCell(totalRow, 1).value).toBe("TOTAL");
    expect(ws.getCell(totalRow, 5).value).toEqual({
      formula: `SUM(E${regulSubtotalRow}+E${week1SubtotalRow}+E${week2SubtotalRow})`,
    });
    expect(ws.getCell(totalRow, 6).value).toEqual({
      formula: `SUM(F${regulSubtotalRow}+F${week1SubtotalRow}+F${week2SubtotalRow})*125%`,
    });
  });

  it("leaves férié (J), compteur 8h (F), gd depl (P), voyage (X), compteur (Z) and chomés (AA) entirely blank for manual entry", async () => {
    const days = emptyWeekDays("2026-08-17");
    days[0]!.normal = 8;
    const week: AccountingWeekInput = { ...BASE_WEEK, isoWeek: 34, days, mealAllowance: 9.81, managementBonus: 3 };
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [week],
      sncfExpense: 10,
      roomDeduction: 5,
    });
    const ws = await readBack(buffer);
    for (let r = 6; r <= 12; r++) {
      expect(ws.getCell(r, 10).value).toBeNull(); // J férié
      expect(ws.getCell(r, 6).value).toBeNull(); // F compteur 8h
      expect(ws.getCell(r, 16).value).toBeNull(); // P gd depl
      expect(ws.getCell(r, 24).value).toBeNull(); // X voyage
      expect(ws.getCell(r, 26).value).toBeNull(); // Z compteur
      expect(ws.getCell(r, 27).value).toBeNull(); // AA chomés
    }
  });
});
