/**
 * Campagne QA — juillet 2026 : le tableau Excel et l'import Silae produits
 * à partir des MÊMES pointages doivent concorder.
 *
 * C'est le test que demandait le cahier des charges Silae (« générer l'export
 * de juillet 2026 et comparer, salarié par salarié, avec les lignes TOTAL de
 * l'Excel actuel »). Faute de disposer du classeur réel, la comparaison se
 * fait ici entre les deux sorties du CRM : si l'agrégation Silae diverge du
 * tableau Excel, l'écart apparaît, et seuls les écarts CONNUS sont admis.
 *
 * Écarts connus, admis et vérifiés explicitement plus bas :
 *   - colonnes Excel tenues à la main, qu'aucune donnée du CRM n'alimente :
 *     compteur 8h (F), « 0.5 » (G), férié (J), gd depl (P), « 80 » (Q),
 *     voyage (X), compteur (Z), chômés (AA) ;
 *   - la colonne « compteur 8h » porte un ×125 % dans le classeur, là où
 *     Silae attend un NOMBRE d'heures non majoré ;
 *   - les heures du dimanche vont en colonne I (« dim ») et non en E
 *     (« heures ») : côté Silae, heuresTravaillees = E + I + H.
 *
 * Périmètre : la chaîne de calcul et de mise en fichier, appelée telle que
 * l'application l'appelle. NE couvre pas collectMonth (lecture en base) ni
 * l'autorisation d'accès, qui exigent un contexte de requête HTTP — à tester
 * par le navigateur.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { aggregateEmployeeMonth, type AggregationWeekInput } from "@/server/silae/aggregate";
import { buildSilaeReport, type MappingRow } from "@/server/silae/report";
import { encodeSilaeCsv, renderSilaeCsv, silaeFileName, SILAE_HEADER } from "@/server/silae/csv";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { buildAccountingWorkbook, type AccountingWeekInput } from "@/server/accounting/xlsx";
import type { PointageDay } from "@/server/pointage/calc";

// --- Chantier de référence -------------------------------------------------
// Montants volontairement ronds : chaque total attendu est recalculable de
// tête, condition pour qu'un écart accuse le code et non l'arithmétique du
// test.
const CHANTIER = {
  lunchAllowance: 20,
  dinnerAllowance: 0,
  travelAllowance: 0,
  maskBonus: 0,
  managementBonus: 100,
  zoneBonus: 0,
  postBonus: 0,
  mealAllowance: 0,
  clothingBonus: 0,
};
const NO_TRAVEL = { kmRate: 0, distanceKm: 0, travelHourlyRate: 0, travelDurationHours: 0 };
const APPLIED = {
  lunchAllowanceApplied: true,
  dinnerAllowanceApplied: false,
  travelAllowanceApplied: false,
  maskBonusApplied: false,
  managementBonusApplied: true,
  zoneBonusApplied: false,
  postBonusApplied: false,
  kmReimbursementApplied: false,
  travelHoursReimbursementApplied: false,
  mealAllowanceApplied: false,
  clothingBonusApplied: false,
};

/** 7 jours à partir d'un lundi ISO ; `null` = jour non travaillé. */
function days(monday: string, perDay: Array<number | null | { jour?: number; nuit?: number }>): PointageDay[] {
  const base = new Date(`${monday}T00:00:00Z`);
  return perDay.map((v, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    if (v === null || v === undefined) return { date, normal: 0, matin: 0, apresMidi: 0, nuit: 0 };
    if (typeof v === "number") return { date, normal: v, matin: 0, apresMidi: 0, nuit: 0 };
    return { date, normal: v.jour ?? 0, matin: 0, apresMidi: 0, nuit: v.nuit ?? 0 };
  });
}

function week(monday: string, perDay: Parameters<typeof days>[1], over: Partial<AggregationWeekInput> = {}): AggregationWeekInput {
  return {
    weekStart: new Date(`${monday}T00:00:00Z`),
    chantierId: "chantier-1",
    days: days(monday, perDay),
    hourlyRate: 12,
    nightRatePercent: 25,
    housingAllowance: 0,
    dirtAllowance: 0,
    gdDepl53Count: 0,
    gdDepl80Count: 0,
    chantierAmounts: CHANTIER,
    assignmentRates: NO_TRAVEL,
    applied: APPLIED,
    sncfExpense: 0,
    roomDeduction: 0,
    ...over,
  };
}

/** Table de correspondance d'un espace neuf : les valeurs par défaut du catalogue. */
const DEFAULT_MAPPINGS: MappingRow[] = RUBRIQUES.map((r) => ({
  rubrique: r.key,
  silaeCode: r.defaultCode,
  multiplier: 1,
  exported: r.defaultExported,
}));

// Juillet 2026 : le 1er est un mercredi, donc lundis les 29/06, 6, 13, 20 et
// 27/07. Le 14 juillet tombe un mardi (semaine du 13), les dimanches sont les
// 5, 12, 19 et 26.
const JUILLET = { year: 2026, month: 7 } as const;

describe("juillet 2026 — agrégation par salarié", () => {
  it("ALPHA : trois semaines pleines, dont le 14 juillet travaillé", () => {
    const weeks = [
      week("2026-07-06", [7, 7, 7, 7, 7, null, null]),
      week("2026-07-13", [7, 7, 7, 7, 7, null, null]),
      week("2026-07-20", [7, 7, 7, 7, 7, null, null]),
    ];
    const { totals, anomalies, monthHours } = aggregateEmployeeMonth(weeks, JUILLET.year, JUILLET.month, {
      exportWorkedHours: true,
    });

    expect(anomalies).toEqual([]);
    expect(monthHours).toBe(105); // 15 jours × 7 h
    expect(totals.heuresTravaillees).toBe(105);
    expect(totals.heuresFerie).toBe(7); // mardi 14 juillet
    expect(totals.heuresDimanche).toBeUndefined();
    expect(totals.repasMidi).toBe(15); // un repas par jour travaillé
    expect(totals.primeManagement).toBe(300); // forfait hebdomadaire × 3
    // 35 h par semaine : aucune heure supplémentaire.
    expect(totals.hs25).toBeUndefined();
    expect(totals.hs50).toBeUndefined();
  });

  it("BRAVO : semaine à cheval juin/juillet, 40 h — le journalier se répartit, l'hebdomadaire va à juillet", () => {
    // Lundi 29 et mardi 30 juin, puis mercredi 1er au vendredi 3 juillet.
    const weeks = [week("2026-06-29", [8, 8, 8, 8, 8, null, null], { dirtAllowance: 5 })];
    const juillet = aggregateEmployeeMonth(weeks, 2026, 7, { exportWorkedHours: true });
    const juin = aggregateEmployeeMonth(weeks, 2026, 6, { exportWorkedHours: true });

    // Journalier : 3 jours en juillet, 2 en juin.
    expect(juillet.totals.heuresTravaillees).toBe(24);
    expect(juin.totals.heuresTravaillees).toBe(16);
    expect(juillet.totals.repasMidi).toBe(3);
    expect(juin.totals.repasMidi).toBe(2);

    // Hebdomadaire : juillet porte la majorité des jours travaillés (3 c. 2).
    expect(juillet.totals.hs25).toBe(5); // 40 h − 35 h, dans la bande des 8 premières
    expect(juillet.totals.hs50).toBeUndefined();
    expect(juillet.totals.primeManagement).toBe(100);
    expect(juillet.totals.primeSalissure).toBe(5);
    expect(juin.totals.hs25).toBeUndefined();
    expect(juin.totals.primeManagement).toBeUndefined();

    // Rien ne doit être perdu ni compté deux fois entre les deux mois.
    expect(juillet.totals.heuresTravaillees! + juin.totals.heuresTravaillees!).toBe(40);
  });

  it("CHARLIE : deux chantiers dans le mois — les frais d'affectation s'ADDITIONNENT", () => {
    // Reproduit BUG-005. aggregate.ts retient Math.max sur toutes les semaines
    // du salarié, chantiers confondus : les frais du second chantier sont
    // perdus. Attendu : 120 + 80 de frais SNCF, 50 + 30 de retenue.
    const weeks = [
      week("2026-07-06", [7, 7, 7, 7, 7, null, null], { chantierId: "c1", sncfExpense: 120, roomDeduction: 50 }),
      week("2026-07-20", [7, 7, 7, 7, 7, null, null], { chantierId: "c2", sncfExpense: 80, roomDeduction: 30 }),
    ];
    const { totals } = aggregateEmployeeMonth(weeks, JUILLET.year, JUILLET.month);

    expect(totals.fraisSncf).toBe(200);
    expect(totals.retenueChambre).toBe(80);
  });

  it("CHARLIE bis : deux semaines du MÊME chantier ne multiplient pas les frais", () => {
    // Le cas que Math.max visait à couvrir, et qui doit rester couvert : les
    // frais sont attachés à l'affectation, pas à la semaine.
    const weeks = [
      week("2026-07-06", [7, 7, 7, 7, 7, null, null], { sncfExpense: 120, roomDeduction: 50 }),
      week("2026-07-13", [7, 7, 7, 7, 7, null, null], { sncfExpense: 120, roomDeduction: 50 }),
    ];
    const { totals } = aggregateEmployeeMonth(weeks, JUILLET.year, JUILLET.month);

    expect(totals.fraisSncf).toBe(120);
    expect(totals.retenueChambre).toBe(50);
  });

  it("ECHO : dimanche et nuit travaillés, valeur négative et semaine excessive signalées", () => {
    const weeks = [
      // Dimanche 12 juillet travaillé 6 h, nuit le jeudi.
      week("2026-07-06", [7, 7, 7, { jour: 0, nuit: 8 }, 7, null, 6]),
      // 63 h : au-delà du seuil d'anomalie (60 h).
      week("2026-07-20", [13, 13, 13, 12, 12, null, null]),
      // Saisie négative.
      week("2026-07-27", [-3, 7, 7, 7, 7, null, null]),
    ];
    const { totals, anomalies } = aggregateEmployeeMonth(weeks, JUILLET.year, JUILLET.month, {
      exportWorkedHours: true,
    });

    expect(totals.heuresNuit).toBe(8);
    expect(totals.heuresDimanche).toBe(6);
    expect(anomalies.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["heures_hebdo_excessives", "valeur_negative"])
    );
  });
});

describe("cumul dimanche et jour férié", () => {
  // DÉFAUT CONNU, non corrigé : la règle de paie applicable (priorité au
  // férié, au dimanche, ou cumul des deux) doit être tranchée par le
  // gestionnaire de paie — la deviner reviendrait à inventer une majoration.
  // `it.fails` documente l'écart sans masquer le défaut : ce test redeviendra
  // rouge le jour où le comportement changera, ce qui forcera à le relire.
  it.fails("un dimanche férié ne doit pas être majoré deux fois", () => {
    // Reproduit BUG-006. Le 1er novembre 2026 (Toussaint) est un dimanche :
    // les heures alimentent à la fois heuresDimanche et heuresFerie, et les
    // deux rubriques étant exportées, Silae applique les deux majorations.
    const weeks = [week("2026-10-26", [null, null, null, null, null, null, 6])];
    const { totals } = aggregateEmployeeMonth(weeks, 2026, 11);

    expect(totals.heuresDimanche).toBe(6);
    expect(totals.heuresFerie).toBeUndefined();
  });
});

describe("rapport de contrôle", () => {
  const employee = (over: Partial<Parameters<typeof buildSilaeReport>[0][number]> = {}) => ({
    userId: "u1",
    name: "ALPHA Jean",
    matricule: "1001",
    monthHours: 105,
    totals: { heuresFerie: 7, repasMidi: 15, primeManagement: 300, primeSalissure: 15 },
    anomalies: [],
    ...over,
  });

  it("bloque la génération quand un salarié porteur d'éléments n'a pas de matricule", () => {
    const { report, lines } = buildSilaeReport([employee({ matricule: null, name: "DELTA Paul" })], DEFAULT_MAPPINGS, {
      ...JUILLET,
      dossier: "Fidem Froid Clim",
    });

    expect(report.blocking).toEqual(["DELTA Paul a des éléments à exporter mais aucun matricule Silae."]);
    expect(lines).toEqual([]); // rien n'est écrit pour un salarié sans matricule
  });

  it("signale une rubrique porteuse de valeur sans code Silae, et ne l'exporte pas", () => {
    const { report, lines } = buildSilaeReport([employee()], DEFAULT_MAPPINGS, {
      ...JUILLET,
      dossier: "Fidem Froid Clim",
    });

    expect(report.blocking).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "« Prime de salissure » porte une valeur mais n'a aucun code Silae : elle ne sera pas exportée.",
      ])
    );
    expect(lines.map((l) => l.code)).not.toContain("");
    expect(lines.map((l) => l.code).sort()).toEqual(["EV-Hferie", "EV-PrimeManagement", "EV-RepasMidi"]);
  });

  it("rappelle ce qui ne passe pas par cet import", () => {
    const { report } = buildSilaeReport([employee()], DEFAULT_MAPPINGS, { ...JUILLET, dossier: "Fidem" });
    expect(report.reminders.join(" ")).toMatch(/RIB/);
    expect(report.reminders.join(" ")).toMatch(/absences/i);
  });
});

describe("fichier d'import Silae", () => {
  it("respecte le format imposé : en-tête, point-virgule, virgule décimale, CRLF", () => {
    const content = renderSilaeCsv([
      { matricule: "0042", code: "HS25", value: 5 },
      { matricule: "0042", code: "EV-IndKm", value: 45.5 },
      { matricule: "1001", code: "EV-RepasMidi", value: 15 },
    ]);

    expect(content.split("\r\n")[0]).toBe(SILAE_HEADER);
    expect(content).toBe(
      "Matricule;Code;Valeur\r\n0042;HS25;5\r\n0042;EV-IndKm;45,5\r\n1001;EV-RepasMidi;15\r\n"
    );
    // Aucune ligne vide, aucune colonne en trop.
    for (const line of content.trimEnd().split("\r\n")) {
      expect(line.split(";")).toHaveLength(3);
      expect(line.trim()).not.toBe("");
    }
    // Le matricule reste du texte : les zéros de tête sont conservés.
    expect(content).toContain("0042;HS25");
  });

  it("n'écrit jamais une ligne à zéro et additionne les doublons", () => {
    const content = renderSilaeCsv([
      { matricule: "1001", code: "HS25", value: 3 },
      { matricule: "1001", code: "HS25", value: 2 },
      { matricule: "1001", code: "EV-Zone", value: 0 },
      { matricule: "1001", code: "EV-Masque", value: 10 },
      { matricule: "1001", code: "EV-Masque", value: -10 },
    ]);

    expect(content).toBe("Matricule;Code;Valeur\r\n1001;HS25;5\r\n");
  });

  it("encode en Windows-1252 par défaut, pas en UTF-8", () => {
    // Un accent doit tenir sur un seul octet : en UTF-8, Silae afficherait
    // des caractères parasites.
    expect(Array.from(encodeSilaeCsv("é", "win1252"))).toEqual([0xe9]);
    expect(Array.from(encodeSilaeCsv("é", "utf8"))).toEqual([0xc3, 0xa9]);
  });

  it("nomme le fichier d'après le dossier et le mois", () => {
    expect(silaeFileName("Fidem Froid Clim", 2026, 7)).toBe("IMPORT_SILAE_FIDEM-FROID-CLIM_2026-07.csv");
  });
});

// --- Comparaison Excel ↔ Silae ---------------------------------------------

/**
 * Somme une colonne sur les seules lignes de JOURS du classeur, en écartant
 * les lignes « sous total » et « TOTAL », qui portent des formules qu'ExcelJS
 * ne calcule pas — et qui feraient double emploi.
 *
 * Disposition produite par buildAccountingWorkbook : lignes 3-4 « régul »,
 * ligne 5 sous-total, puis un bloc de 8 lignes par semaine (7 jours + 1
 * sous-total) à partir de la ligne 6.
 */
function sumDayColumn(ws: ExcelJS.Worksheet, weekCount: number, col: number): number {
  let total = 0;
  for (let w = 0; w < weekCount; w++) {
    for (let r = 6 + 8 * w; r <= 12 + 8 * w; r++) {
      const v = ws.getCell(r, col).value;
      if (typeof v === "number") total += v;
    }
  }
  return Math.round(total * 100) / 100;
}

const MANUAL_COLUMNS: Array<[string, number]> = [
  ["F compteur 8h", 6],
  ["G 0.5", 7],
  ["J férié", 10],
  ["P gd depl 53", 16],
  ["Q 80", 17],
  ["X voyage", 24],
  ["Z compteur", 26],
  ["AA chômés", 27],
];

describe("juillet 2026 — le tableau Excel et l'import Silae concordent", () => {
  // Mêmes pointages pour les deux sorties : un dimanche travaillé et une nuit,
  // précisément là où les deux fichiers ne rangent pas les heures pareil.
  const perWeek: Array<Parameters<typeof days>[1]> = [
    [7, 7, 7, { jour: 0, nuit: 8 }, 7, null, 6], // s28 — dimanche 12/07 travaillé
    [7, 7, 7, 7, 7, null, null], // s29
  ];
  const mondays = ["2026-07-06", "2026-07-13"];

  const silaeWeeks = mondays.map((m, i) => week(m, perWeek[i]!, { sncfExpense: 120, roomDeduction: 50 }));
  const excelWeeks: AccountingWeekInput[] = mondays.map((m, i) => ({
    isoWeek: 28 + i,
    days: days(m, perWeek[i]!),
    housingAllowance: 0,
    lunchAllowance: CHANTIER.lunchAllowance,
    dinnerAllowance: 0,
    mealAllowance: 0,
    managementBonus: CHANTIER.managementBonus,
    clothingBonus: 0,
    postBonus: 0,
    maskBonus: 0,
    zoneBonus: 0,
    kmPerDay: 0,
  }));

  async function workbook(): Promise<ExcelJS.Worksheet> {
    const buffer = await buildAccountingWorkbook({
      employeeName: "ECHO Marc",
      chantierName: "QA Chantier 1",
      weeks: excelWeeks,
      sncfExpense: 120,
      roomDeduction: 50,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Classeur sans feuille.");
    return ws;
  }

  it("les heures concordent : Silae heuresTravaillees = Excel E + I + H", async () => {
    const ws = await workbook();
    const { totals } = aggregateEmployeeMonth(silaeWeeks, JUILLET.year, JUILLET.month, { exportWorkedHours: true });

    const heures = sumDayColumn(ws, excelWeeks.length, 5); // E
    const dim = sumDayColumn(ws, excelWeeks.length, 9); // I
    const nuit = sumDayColumn(ws, excelWeeks.length, 8); // H

    // Le classeur range le dimanche à part et la nuit dans sa propre colonne.
    expect(dim).toBe(totals.heuresDimanche);
    expect(nuit).toBe(totals.heuresNuit);
    expect(heures + dim + nuit).toBe(totals.heuresTravaillees);
  });

  it("les indemnités et primes concordent, rubrique par rubrique", async () => {
    const ws = await workbook();
    const { totals } = aggregateEmployeeMonth(silaeWeeks, JUILLET.year, JUILLET.month);

    // M « repas midi 20 » porte un MONTANT par jour travaillé ; Silae attend
    // un NOMBRE de repas. Le rapprochement se fait par le montant unitaire.
    expect(sumDayColumn(ws, excelWeeks.length, 13)).toBe(totals.repasMidi! * CHANTIER.lunchAllowance);
    expect(sumDayColumn(ws, excelWeeks.length, 19)).toBe(totals.primeManagement); // S management
    expect(sumDayColumn(ws, excelWeeks.length, 12)).toBe(totals.fraisSncf); // L frais SNCF
    expect(sumDayColumn(ws, excelWeeks.length, 23)).toBe(totals.retenueChambre); // W retenue de chambre
  });

  it("les colonnes tenues à la main restent vides — écart connu et assumé", async () => {
    const ws = await workbook();
    for (const [label, col] of MANUAL_COLUMNS) {
      expect(sumDayColumn(ws, excelWeeks.length, col), `${label} doit rester vierge`).toBe(0);
    }
  });

  it("le CRM calcule des heures fériées que le classeur n'a jamais portées", async () => {
    // Semaine du 13 juillet : le 14 est férié. Le classeur laisse la colonne J
    // vierge, l'import Silae porte la valeur — c'est un gain, pas un écart à
    // corriger, mais il doit rester visible.
    const ws = await workbook();
    const weeks13 = [week("2026-07-13", [7, 7, 7, 7, 7, null, null])];
    const { totals } = aggregateEmployeeMonth(weeks13, JUILLET.year, JUILLET.month);

    expect(totals.heuresFerie).toBe(7);
    expect(sumDayColumn(ws, excelWeeks.length, 10)).toBe(0); // J férié, vierge
  });
});
