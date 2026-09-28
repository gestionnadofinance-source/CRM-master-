import "server-only";

/**
 * Jours fériés français, calculés plutôt que stockés : la table ne
 * dépendrait que de l'année et il faudrait penser à l'alimenter chaque
 * année — une source d'oubli silencieux dans un export de paie.
 *
 * Les fériés fixes sont donnés par leur date ; les quatre mobiles
 * (lundi de Pâques, Ascension, lundi de Pentecôte) dérivent de Pâques.
 *
 * Périmètre : France métropolitaine. Les jours spécifiques à l'Alsace-Moselle
 * (Vendredi saint, 26 décembre) et aux départements d'outre-mer ne sont PAS
 * inclus — à ajouter ici si l'entreprise y emploie des salariés.
 */

/** Dimanche de Pâques (algorithme de Butcher, calendrier grégorien), en UTC. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Dates ISO (yyyy-mm-dd) des jours fériés de l'année donnée. */
export function frenchHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`, // Jour de l'an
    iso(addDays(easter, 1)), // Lundi de Pâques
    `${year}-05-01`, // Fête du Travail
    `${year}-05-08`, // Victoire 1945
    iso(addDays(easter, 39)), // Ascension
    iso(addDays(easter, 50)), // Lundi de Pentecôte
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice 1918
    `${year}-12-25`, // Noël
  ]);
}

const cache = new Map<number, Set<string>>();

/** `true` si la date ISO (yyyy-mm-dd) est un jour férié. */
export function isFrenchHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  let set = cache.get(year);
  if (!set) {
    set = frenchHolidays(year);
    cache.set(year, set);
  }
  return set.has(isoDate);
}
