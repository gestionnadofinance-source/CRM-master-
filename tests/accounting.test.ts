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
  travelAllowance: 0,
  gdDepl53Count: 0,
  gdDepl80Count: 0,
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

  it("compte les repas en NOMBRE d'occurrences, et non en euros — le tarif est dans l'intitulé de la colonne", async () => {
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
    // Le classeur de référence porte « 1 » par repas, pas 9,81 € : la colonne
    // s'intitule « repas 9,81 » et la paie applique le tarif. Y écrire des
    // euros faisait compter le montant deux fois.
    expect(ws.getCell(weekFirstRow, 15).value).toBe(1); // O lundi
    expect(ws.getCell(weekFirstRow + 1, 15).value).toBe(1); // O mardi
    expect(ws.getCell(weekFirstRow + 2, 15).value).toBeNull(); // mercredi non travaillé
    // Les kilomètres restent un MONTANT, eux.
    expect(ws.getCell(weekFirstRow, 11).value).toBe(50); // K lundi
  });

  it("distingue les forfaits hebdomadaires des primes journalières", async () => {
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
    // Forfaits de la SEMAINE : une seule fois, sur le premier jour travaillé.
    expect(ws.getCell(wednesdayRow, 18).value).toBe(10); // R logement
    expect(ws.getCell(wednesdayRow, 19).value).toBe(3); // S management
    // Habillage : un NOMBRE par semaine, comme les repas.
    expect(ws.getCell(wednesdayRow, 20).value).toBe(1); // T prime habillage
    // Primes JOURNALIÈRES : leur montant se répète sur chaque jour travaillé.
    expect(ws.getCell(wednesdayRow, 21).value).toBe(4); // U poste
    expect(ws.getCell(wednesdayRow, 22).value).toBe(1); // V masque
    expect(ws.getCell(wednesdayRow, 25).value).toBe(2); // Y zone
    // Rien sur le lundi (premier jour du bloc, mais pas travaillé)
    expect(ws.getCell(6, 19).value).toBeNull();
    expect(ws.getCell(6, 21).value).toBeNull();
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

describe("conformité au classeur de référence", () => {
  /**
   * Le classeur fourni par Fidem découpe ses semaines au mois : sa première
   * commence au 1er (un mercredi en juillet 2026) et sa dernière s'arrête au
   * 31. Un TOTAL qui déborderait ferait payer en juillet des heures d'août.
   */
  it("n'écrit que les jours du mois de paie et numérote les jours selon leur vraie date", async () => {
    // Semaine du lundi 27 juillet au dimanche 2 août 2026 : cinq jours de
    // juillet, deux d'août.
    const days = emptyWeekDays("2026-07-27");
    for (const d of days) d.normal = 7;
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [{ ...BASE_WEEK, isoWeek: 31, days }],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);

    // Cinq lignes de jours, puis le sous-total : les 1er et 2 août sont hors
    // du mois de paie et n'apparaissent pas.
    expect(ws.getCell(6, 3).value).toBe(27);
    expect(ws.getCell(10, 3).value).toBe(31);
    expect(String(ws.getCell(11, 2).value)).toContain("sous total");
    expect(ws.getCell(6, 2).value).toBe("L");
    expect(ws.getCell(10, 2).value).toBe("V");
  });

  it("marque le jour férié dans la colonne des quantièmes et reporte ses heures", async () => {
    // Mardi 14 juillet 2026 : férié travaillé.
    const days = emptyWeekDays("2026-07-13");
    days[1]!.normal = 7;
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [{ ...BASE_WEEK, isoWeek: 29, days }],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);

    expect(ws.getCell(7, 3).value).toBe("14 F");
    expect(ws.getCell(7, 10).value).toBe(7); // J férié
    expect(ws.getCell(7, 5).value).toBe(7); // E heures, inchangé
    // Un jour ordinaire garde son quantième numérique.
    expect(ws.getCell(6, 3).value).toBe(13);
  });

  it("reporte l'indemnité de trajet et les grands déplacements, que le CRM détenait sans les écrire", async () => {
    const days = emptyWeekDays("2026-07-06");
    days[0]!.normal = 8;
    days[1]!.normal = 8;
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [{ ...BASE_WEEK, isoWeek: 28, days, travelAllowance: 12.5, gdDepl53Count: 3, gdDepl80Count: 2 }],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);

    // X voyage : un montant par jour travaillé.
    expect(ws.getCell(6, 24).value).toBe(12.5);
    expect(ws.getCell(7, 24).value).toBe(12.5);
    expect(ws.getCell(8, 24).value).toBeNull(); // mercredi non travaillé
    // P et Q : des NOMBRES, posés une fois pour la semaine.
    expect(ws.getCell(6, 16).value).toBe(3);
    expect(ws.getCell(6, 17).value).toBe(2);
  });

  it("laisse vierges les trois colonnes sans source dans l'ERP", async () => {
    // F « compteur 8h », G « 0.5 » et AA « chômés » restent à saisir à la
    // main : aucune donnée du parcours chantier → ouvrier → pointage ne les
    // alimente, et en inventer une valeur serait pire que de les laisser vides.
    const days = emptyWeekDays("2026-07-06");
    days[0]!.normal = 8;
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [{ ...BASE_WEEK, isoWeek: 28, days }],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    for (const col of [6, 7, 27]) expect(ws.getCell(6, col).value).toBeNull();
  });
});

describe("robustesse du découpage mensuel", () => {
  it("une semaine d'un seul jour dans le mois ne produit pas de fusion corrompue", async () => {
    // Août 2026 : le 31 est un lundi, seul jour d'août de sa semaine. Une
    // fusion 1×1 (D31:D31) rendrait le fichier « à réparer » pour Excel.
    const days = emptyWeekDays("2026-08-31"); // lundi 31 août → dimanche 6 sept
    days[0]!.normal = 7; // seul le lundi 31 est en août
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [{ ...BASE_WEEK, isoWeek: 36, days }],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    // Une seule ligne de jour (le 31), puis le sous-total.
    expect(ws.getCell(6, 3).value).toBe(31);
    expect(String(ws.getCell(7, 2).value)).toContain("sous total");
    // Aucune fusion dégénérée (début == fin) dans le classeur relu.
    for (const m of ws.model.merges ?? []) {
      const [tl, br] = String(m).split(":");
      expect(tl, `fusion 1×1 détectée : ${m}`).not.toBe(br);
    }
  });

  it("le forfait d'une semaine à cheval va au mois qui la possède, pas à l'autre", async () => {
    // Un classeur d'AOÛT (majorité des jours en août) qui contient AUSSI la
    // semaine lundi 27 juillet → dimanche 2 août. Cette semaine est possédée
    // par juillet (5 jours contre 2) : ses jours d'août s'affichent, mais son
    // forfait de management doit rester au classeur de juillet — exactement la
    // règle owningMonth de l'export Silae, pour que les deux fichiers imputent
    // le forfait au même mois.
    const straddle = emptyWeekDays("2026-07-27");
    for (const d of straddle) d.normal = 7;
    const semAout = (lundi: string) => {
      const d = emptyWeekDays(lundi);
      for (const x of d) x.normal = 7;
      return d;
    };
    const buffer = await buildAccountingWorkbook({
      employeeName: "Jean Ouvrier",
      chantierName: "Chantier Test",
      weeks: [
        { ...BASE_WEEK, isoWeek: 31, days: straddle, managementBonus: 100 },
        { ...BASE_WEEK, isoWeek: 32, days: semAout("2026-08-03"), managementBonus: 100 },
        { ...BASE_WEEK, isoWeek: 33, days: semAout("2026-08-10"), managementBonus: 100 },
      ],
      sncfExpense: 0,
      roomDeduction: 0,
    });
    const ws = await readBack(buffer);
    // La semaine à cheval n'apparaît que par ses 2 jours d'août (1er, 2).
    expect(ws.getCell(6, 3).value).toBe(1);
    expect(ws.getCell(7, 3).value).toBe(2);
    // Son management (col S = 19) est SUPPRIMÉ : il va au classeur de juillet.
    expect(ws.getCell(6, 19).value).toBeNull();
    expect(ws.getCell(7, 19).value).toBeNull();
    // La première semaine pleinement en août (bloc suivant) porte bien le sien.
    // Bloc 1 : lignes 6-7 (2 jours) + sous-total 8. Bloc 2 démarre en 9.
    expect(ws.getCell(9, 19).value).toBe(100);
  });
});

