import "server-only";
import iconv from "iconv-lite";

/**
 * Écriture du fichier d'import standard Silae (« importsilae »).
 *
 * Format imposé par Silae, à ne pas assouplir :
 *   - séparateur point-virgule, exactement 3 colonnes ;
 *   - décimale VIRGULE, sans séparateur de milliers ;
 *   - première ligne d'en-tête, que Silae n'importe jamais ;
 *   - aucune ligne à valeur nulle, aucune ligne vide, aucune colonne en trop.
 *
 * Fins de ligne CRLF et encodage Windows-1252 par défaut : Silae est un
 * outil Windows, et un fichier en UTF-8 y fait apparaître les accents en
 * caractères parasites. L'option UTF-8 reste offerte, l'encodage retenu
 * étant à valider par un essai d'import réel.
 */
export type SilaeEncoding = "win1252" | "utf8";

export interface SilaeLine {
  /** Matricule Silae, traité comme du TEXTE : les zéros en tête comptent. */
  matricule: string;
  code: string;
  value: number;
}

export const SILAE_HEADER = "Matricule;Code;Valeur";

/** Formate un nombre à la française : 2 décimales maximum, virgule, pas de milliers. */
export function formatSilaeNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  // `toFixed(2)` puis retrait des décimales inutiles : 15 reste « 15 »,
  // 2693,04 reste « 2693,04 », et 0,1 + 0,2 ne devient pas
  // « 0,30000000000000004 ».
  return rounded
    .toFixed(2)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

/**
 * Fusionne les lignes de même (matricule, code) en les additionnant, et
 * écarte celles dont la valeur finale est nulle.
 *
 * Silae n'additionne pas deux lignes portant la même clé : selon les
 * versions, la seconde écrase la première ou est ignorée. L'addition doit
 * donc être faite ici, jamais laissée au hasard de l'import.
 */
export function mergeSilaeLines(lines: SilaeLine[]): SilaeLine[] {
  const merged = new Map<string, SilaeLine>();
  for (const line of lines) {
    const key = `${line.matricule}\u0000${line.code}`;
    const existing = merged.get(key);
    if (existing) existing.value += line.value;
    else merged.set(key, { ...line });
  }
  return Array.from(merged.values())
    .map((l) => ({ ...l, value: Math.round(l.value * 100) / 100 }))
    .filter((l) => l.value !== 0);
}

/** Rend le contenu texte du fichier (en-tête compris), sans l'encoder. */
export function renderSilaeCsv(lines: SilaeLine[]): string {
  const body = mergeSilaeLines(lines).map((l) => `${l.matricule};${l.code};${formatSilaeNumber(l.value)}`);
  return [SILAE_HEADER, ...body].join("\r\n") + "\r\n";
}

export function encodeSilaeCsv(content: string, encoding: SilaeEncoding): Buffer {
  return encoding === "utf8" ? Buffer.from(content, "utf8") : iconv.encode(content, "win1252");
}

/** IMPORT_SILAE_<dossier>_<AAAA-MM>.csv — le nom suggéré par le cahier des charges. */
export function silaeFileName(dossier: string, year: number, month: number): string {
  const slug = dossier
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
  return `IMPORT_SILAE_${slug}_${year}-${String(month).padStart(2, "0")}.csv`;
}
