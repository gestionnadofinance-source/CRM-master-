import "server-only";
import ExcelJS from "exceljs";

/**
 * Génère le tableau de comptabilité Excel à partir des fiches de pointage
 * déposées sélectionnées par la secrétaire (voir src/server/accounting/actions.ts).
 * Reproduit fidèlement le modèle fourni — structure, formules ET mise en
 * forme (polices, couleurs, bordures, largeurs/hauteurs, formats de
 * nombre) — pour qu'un salarié/chantier donné produise un fichier visuellement
 * identique au modèle, seules les données diffèrent : un bloc "régul" vierge
 * en tête, un bloc de 7 lignes par semaine sélectionnée (jour/date/heures/
 * indemnités), une ligne "sous total" par bloc (formules SUM), une ligne
 * TOTAL agrégeant tous les blocs (la colonne "compteur 8h" reste, comme dans
 * le modèle, une formule *125% — pourcentage que la secrétaire ajuste
 * elle-même dans Excel), et un bloc "note de frais" vierge en bas de page.
 *
 * Colonnes volontairement laissées VIERGES pour saisie manuelle par la
 * secrétaire (aucune donnée source fiable dans le CRM) : compteur 8h (F),
 * la colonne "0.5" (G), férié (J), grand déplacement (P), la colonne "80"
 * (Q), voyage (X), compteur (Z), chômés (AA), et tout le bloc note de frais.
 */

export interface AccountingDay {
  date: string; // ISO yyyy-mm-dd
  normal: number;
  matin: number;
  apresMidi: number;
  nuit: number;
}

/** Une semaine de pointage déjà résolue (montants effectifs, 0 si la case n'était pas cochée). */
export interface AccountingWeekInput {
  isoWeek: number;
  days: AccountingDay[]; // 7 entrées, lundi en premier
  housingAllowance: number;
  lunchAllowance: number;
  dinnerAllowance: number;
  mealAllowance: number;
  managementBonus: number;
  clothingBonus: number;
  postBonus: number;
  maskBonus: number;
  zoneBonus: number;
  kmPerDay: number; // distanceKm x kmRate, 0 si le remboursement km n'était pas coché
}

export interface AccountingExportInput {
  employeeName: string;
  chantierName: string;
  weeks: AccountingWeekInput[]; // chronologique, semaines ISO distinctes
  sncfExpense: number;
  roomDeduction: number;
}

const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

/** Intitulés des colonnes D à AA (24 colonnes), identiques au modèle fourni. */
const HEADERS: Array<string | number> = [
  "chantier",
  "heures ",
  "compteur 8h",
  0.5,
  "nuit",
  "dim",
  "férie",
  "km ",
  "frais sncf",
  "repas midi 20",
  "repas soir 20",
  "repas 9,81",
  "gd depl 53",
  80,
  "logement",
  "management",
  "prime habillage",
  "poste",
  "masque ",
  "retenue de chambre",
  "voyage",
  "zone",
  "compteur",
  "chomés",
];
const FIRST_DATA_COL = 4; // D
const LAST_COL = 27; // AA
const COMPTEUR_8H_COL = 6; // F — seule colonne majorée (*125%) sur la ligne TOTAL

// Couleurs relevées sur le modèle fourni (ARGB).
const FILL_HEADER_LABEL = "FFF2F2F2"; // "jours" / "chantier"
const FILL_HEADER_DATA = "FFD9D9D9"; // en-têtes des colonnes de données
const FILL_WEEK_GREEN = "FF92D050";
const FILL_WEEK_BLUE = "FF8EA9DB";
const FILL_SUBTOTAL = "FFBFBFBF";
const FILL_TOTAL = "FFFFC000";
const FILL_NOTE_LABEL = "FF92D050";
const FILL_NOTE_TOTAL = "FFFFFF00";

const DEFAULT_COL_WIDTH = 9.42578125;
const CHANTIER_COL_WIDTH = 11.42578125; // D
const Q_COL_WIDTH = 10.7109375; // Q ("80")
const HEADER_ROW_HEIGHT = 29.25;
const TOTAL_ROW_HEIGHT = 30;
const NOTE_LABEL_ROW_HEIGHT = 14.25;

const THIN = { style: "thin" as const };
const THIN_BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayHours(d: AccountingDay): number {
  return round2((d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0));
}

/**
 * Applique bordure fine + format "0.00" à une ligne, de `fromCol` à AA.
 * `fromCol` doit rester à 2 (colonne B) pour les lignes de sous-total : la
 * colonne A y est déjà la cellule fusionnée du numéro de semaine (couvrant
 * aussi cette ligne) — la re-styler ici écraserait sa couleur alternée, vu
 * qu'exceljs partage le même modèle de cellule pour toute plage fusionnée.
 */
function styleDataRow(ws: ExcelJS.Worksheet, row: number, fill?: string, fromCol = 1): void {
  for (let c = fromCol; c <= LAST_COL; c++) {
    const cell = ws.getCell(row, c);
    cell.border = THIN_BORDER;
    if (c >= FIRST_DATA_COL) cell.numFmt = "0.00";
    if (fill) cell.fill = solidFill(fill);
  }
}

function writeSumRow(ws: ExcelJS.Worksheet, targetRow: number, fromRow: number, toRow: number, label: string): void {
  ws.mergeCells(targetRow, 2, targetRow, 3);
  ws.getCell(targetRow, 2).value = label;
  styleDataRow(ws, targetRow, FILL_SUBTOTAL, 2);
  ws.getRow(targetRow).font = { bold: true };
  for (let c = FIRST_DATA_COL; c <= LAST_COL; c++) {
    const l = colLetter(c);
    ws.getCell(targetRow, c).value = { formula: `SUM(${l}${fromRow}:${l}${toRow})` } as ExcelJS.CellFormulaValue;
  }
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || "salarié").slice(0, 31);
}

export async function buildAccountingWorkbook(input: AccountingExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName(input.employeeName));
  ws.properties.defaultColWidth = DEFAULT_COL_WIDTH;
  ws.getColumn(FIRST_DATA_COL).width = CHANTIER_COL_WIDTH; // D
  ws.getColumn(17).width = Q_COL_WIDTH; // Q

  // Titre — identique au modèle : non gras, taille normale, sans fond.
  ws.mergeCells(1, 1, 1, LAST_COL);
  ws.getCell(1, 1).value = input.employeeName;
  ws.getCell(1, 1).font = { name: "Calibri", size: 11 };

  // En-têtes.
  ws.getRow(2).height = HEADER_ROW_HEIGHT;
  ws.mergeCells(2, 2, 2, 3);
  const joursCell = ws.getCell(2, 2);
  joursCell.value = "jours";
  joursCell.font = { name: "Calibri", size: 11 };
  joursCell.fill = solidFill(FILL_HEADER_LABEL);
  joursCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  joursCell.border = THIN_BORDER;
  ws.getCell(2, 3).border = THIN_BORDER;

  const chantierHeaderCell = ws.getCell(2, FIRST_DATA_COL);
  chantierHeaderCell.value = "chantier";
  chantierHeaderCell.font = { name: "Calibri", size: 11 };
  chantierHeaderCell.fill = solidFill(FILL_HEADER_LABEL);
  chantierHeaderCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  chantierHeaderCell.border = THIN_BORDER;

  HEADERS.slice(1).forEach((label, i) => {
    const cell = ws.getCell(2, FIRST_DATA_COL + 1 + i);
    cell.value = label;
    cell.font = { name: "Calibri", size: 9, bold: true };
    cell.fill = solidFill(FILL_HEADER_DATA);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });

  let row = 3;
  const weekSubtotalRows: number[] = [];

  // Bloc "régul" : 2 lignes vierges pour d'éventuelles corrections manuelles.
  ws.getRow(3).height = HEADER_ROW_HEIGHT;
  ws.getRow(4).height = HEADER_ROW_HEIGHT;
  ws.mergeCells(3, 1, 4, 1);
  ws.getCell(3, 1).value = "régul";
  const regulFirstRow = row;
  for (const r of [3, 4]) {
    ws.getCell(r, 1).fill = solidFill(FILL_HEADER_LABEL);
    ws.getCell(r, 1).border = THIN_BORDER;
    ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(r, 2, r, 3);
    styleDataRow(ws, r, FILL_HEADER_LABEL);
  }
  row += 2;
  writeSumRow(ws, row, regulFirstRow, row - 1, "sous total");
  weekSubtotalRows.push(row);
  row += 1;

  let firstWorkedRowOverall: number | null = null;

  input.weeks.forEach((week, weekIndex) => {
    const weekFirstRow = row;
    const subtotalRow = weekFirstRow + 7;
    const weekColor = weekIndex % 2 === 0 ? FILL_WEEK_GREEN : FILL_WEEK_BLUE;

    // La cellule fusionnée du numéro de semaine couvre les 7 jours ET la
    // ligne de sous-total (comme dans le modèle), avec la couleur alternée.
    ws.mergeCells(weekFirstRow, 1, subtotalRow, 1);
    const weekLabelCell = ws.getCell(weekFirstRow, 1);
    weekLabelCell.value = `s${week.isoWeek}`;
    weekLabelCell.fill = solidFill(weekColor);
    weekLabelCell.alignment = { horizontal: "center", vertical: "middle" };
    weekLabelCell.border = THIN_BORDER;

    ws.mergeCells(weekFirstRow, FIRST_DATA_COL, weekFirstRow + 6, FIRST_DATA_COL);
    ws.getCell(weekFirstRow, FIRST_DATA_COL).value = input.chantierName;
    ws.mergeCells(weekFirstRow, 6, weekFirstRow + 6, 6); // compteur 8h — vierge
    ws.mergeCells(weekFirstRow, 7, weekFirstRow + 6, 7); // colonne "0.5" — vierge

    let firstWorkedRowThisWeek: number | null = null;

    week.days.forEach((d, i) => {
      const r = row + i;
      styleDataRow(ws, r);
      ws.getCell(r, 2).fill = solidFill(weekColor);
      ws.getCell(r, 3).fill = solidFill(weekColor);
      ws.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };

      const date = new Date(`${d.date}T00:00:00Z`);
      const isSunday = date.getUTCDay() === 0;
      ws.getCell(r, 2).value = DAY_LETTERS[i];
      ws.getCell(r, 3).value = date.getUTCDate();

      const hours = dayHours(d);
      const worked = hours > 0 || d.nuit > 0;
      if (hours > 0) {
        ws.getCell(r, isSunday ? 9 : 5).value = hours; // I (dim) ou E (heures)
      }
      if (d.nuit > 0) {
        ws.getCell(r, 8).value = round2(d.nuit); // H nuit
      }
      if (worked && week.kmPerDay > 0) {
        ws.getCell(r, 11).value = round2(week.kmPerDay); // K km
      }
      if (worked && week.lunchAllowance > 0) {
        ws.getCell(r, 13).value = round2(week.lunchAllowance); // M repas midi
      }
      if (worked && week.dinnerAllowance > 0) {
        ws.getCell(r, 14).value = round2(week.dinnerAllowance); // N repas soir
      }
      if (worked && week.mealAllowance > 0) {
        ws.getCell(r, 15).value = round2(week.mealAllowance); // O repas 9,81
      }
      if (worked) {
        if (firstWorkedRowThisWeek === null) firstWorkedRowThisWeek = r;
        if (firstWorkedRowOverall === null) firstWorkedRowOverall = r;
      }
    });

    // Primes forfaitaires par semaine : placées une seule fois (premier
    // jour travaillé de la semaine) — la formule SUM du sous-total les
    // totalise correctement même non réparties sur les 7 jours.
    const anchor = firstWorkedRowThisWeek ?? row;
    if (week.housingAllowance > 0) ws.getCell(anchor, 18).value = round2(week.housingAllowance); // R logement
    if (week.managementBonus > 0) ws.getCell(anchor, 19).value = round2(week.managementBonus); // S management
    if (week.clothingBonus > 0) ws.getCell(anchor, 20).value = round2(week.clothingBonus); // T prime habillage
    if (week.postBonus > 0) ws.getCell(anchor, 21).value = round2(week.postBonus); // U poste
    if (week.maskBonus > 0) ws.getCell(anchor, 22).value = round2(week.maskBonus); // V masque
    if (week.zoneBonus > 0) ws.getCell(anchor, 25).value = round2(week.zoneBonus); // Y zone

    row += 7;
    writeSumRow(ws, row, weekFirstRow, row - 1, "sous total");
    weekSubtotalRows.push(row);
    row += 1;
  });

  // Frais SNCF et retenue de chambre : montants uniques pour toute la
  // période exportée (pas une indemnité hebdomadaire) — placés une seule
  // fois, sur le tout premier jour travaillé de l'export.
  if (firstWorkedRowOverall !== null) {
    if (input.sncfExpense > 0) ws.getCell(firstWorkedRowOverall, 12).value = round2(input.sncfExpense); // L
    if (input.roomDeduction > 0) ws.getCell(firstWorkedRowOverall, 23).value = round2(input.roomDeduction); // W
  }

  const totalRow = row;
  ws.getRow(totalRow).height = TOTAL_ROW_HEIGHT;
  styleDataRow(ws, totalRow, FILL_TOTAL);
  ws.getCell(totalRow, 1).value = "TOTAL";
  ws.getRow(totalRow).font = { bold: true, size: 11 };
  for (let c = FIRST_DATA_COL; c <= LAST_COL; c++) {
    const l = colLetter(c);
    const sumExpr = weekSubtotalRows.map((r) => `${l}${r}`).join("+");
    const formula = c === COMPTEUR_8H_COL ? `SUM(${sumExpr})*125%` : `SUM(${sumExpr})`;
    ws.getCell(totalRow, c).value = { formula } as ExcelJS.CellFormulaValue;
  }
  row += 1;

  // Total repas (midi + soir), sous la ligne TOTAL — comme dans le modèle.
  ws.mergeCells(row, 13, row, 14);
  ws.getCell(row, 13).value = { formula: `SUM(M${totalRow}:N${totalRow})` } as ExcelJS.CellFormulaValue;
  ws.getCell(row, 13).numFmt = "0.00";
  row += 2;

  // Bloc "note de frais" — entièrement vierge, à remplir à la main.
  ws.getRow(row).height = NOTE_LABEL_ROW_HEIGHT;
  ws.mergeCells(row, 1, row, 10);
  const noteLabelCell = ws.getCell(row, 1);
  noteLabelCell.value = "note de frais : ";
  noteLabelCell.fill = solidFill(FILL_NOTE_LABEL);
  for (let c = 1; c <= 10; c++) ws.getCell(row, c).border = THIN_BORDER;
  row += 1;
  const noteFirstRow = row;
  for (let i = 0; i < 4; i++) {
    ws.mergeCells(row, 1, row, 4);
    ws.mergeCells(row, 5, row, 9);
    for (let c = 1; c <= 10; c++) ws.getCell(row, c).border = THIN_BORDER;
    row += 1;
  }
  ws.mergeCells(row, 1, row, 9);
  const noteTotalLabelCell = ws.getCell(row, 1);
  noteTotalLabelCell.value = "TOTAL : ";
  noteTotalLabelCell.fill = solidFill(FILL_NOTE_TOTAL);
  ws.getCell(row, 10).value = { formula: `SUM(J${noteFirstRow}:J${row - 1})` } as ExcelJS.CellFormulaValue;
  ws.getCell(row, 10).fill = solidFill(FILL_NOTE_TOTAL);
  for (let c = 1; c <= 10; c++) ws.getCell(row, c).border = THIN_BORDER;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
