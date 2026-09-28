import "server-only";
import { RUBRIQUES, RUBRIQUE_BY_KEY, type RubriqueUnit } from "@/server/silae/rubriques";
import type { WeekAnomaly } from "@/server/silae/aggregate";
import type { SilaeLine } from "@/server/silae/csv";

/**
 * Rapport de contrôle produit AVANT toute génération de fichier.
 *
 * Silae n'émet aucune erreur sur un fichier mal formé : un code inconnu est
 * ignoré sans prévenir, un matricule inconnu aussi. Le seul filet possible
 * est donc en amont, ici — d'où la distinction entre ce qui BLOQUE la
 * génération et ce qui la laisse passer avec un avertissement.
 */
export interface ReportRubriqueLine {
  rubrique: string;
  label: string;
  unit: RubriqueUnit;
  /** Valeur agrégée par le CRM, avant multiplicateur. */
  value: number;
  code: string;
  multiplier: number;
  exported: boolean;
  /** Valeur réellement écrite dans le fichier (valeur × multiplicateur). */
  exportedValue: number;
}

export interface ReportEmployee {
  userId: string;
  name: string;
  matricule: string | null;
  monthHours: number;
  lines: ReportRubriqueLine[];
  anomalies: WeekAnomaly[];
}

export interface SilaeReport {
  year: number;
  month: number;
  dossier: string;
  employees: ReportEmployee[];
  /** Empêchent la génération tant qu'ils ne sont pas levés. */
  blocking: string[];
  warnings: string[];
  /** Rappels : ce qui ne passe pas par cet import et reste à saisir à la main. */
  reminders: string[];
  lineCount: number;
}

export interface MappingRow {
  rubrique: string;
  silaeCode: string;
  multiplier: number;
  exported: boolean;
}

export interface EmployeeInput {
  userId: string;
  name: string;
  matricule: string | null;
  monthHours: number;
  totals: Record<string, number>;
  anomalies: WeekAnomaly[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Assemble le rapport et les lignes du fichier à partir des totaux agrégés
 * et de la table de correspondance. Les deux sont produits ensemble, à
 * dessein : ce que montre le rapport est exactement ce que contiendra le
 * fichier, jamais un second calcul qui pourrait en diverger.
 */
export function buildSilaeReport(
  employees: EmployeeInput[],
  mappings: MappingRow[],
  context: { year: number; month: number; dossier: string }
): { report: SilaeReport; lines: SilaeLine[] } {
  const byRubrique = new Map(mappings.map((m) => [m.rubrique, m]));
  const lines: SilaeLine[] = [];
  const blocking: string[] = [];
  const warningSet = new Set<string>();

  const reportEmployees: ReportEmployee[] = employees.map((emp) => {
    const reportLines: ReportRubriqueLine[] = [];

    for (const def of RUBRIQUES) {
      const value = round2(emp.totals[def.key] ?? 0);
      if (value === 0) continue;

      const mapping = byRubrique.get(def.key);
      const code = mapping?.silaeCode?.trim() ?? "";
      const multiplier = mapping?.multiplier ?? 1;
      const exported = mapping?.exported ?? def.defaultExported;
      const exportedValue = round2(value * multiplier);

      reportLines.push({
        rubrique: def.key, label: def.label, unit: def.unit,
        value, code, multiplier, exported, exportedValue,
      });

      if (exported && !code) {
        warningSet.add(`« ${def.label} » porte une valeur mais n'a aucun code Silae : elle ne sera pas exportée.`);
        continue;
      }
      if (exported && emp.matricule) {
        lines.push({ matricule: emp.matricule, code, value: exportedValue });
      }
    }

    if (reportLines.length > 0 && !emp.matricule) {
      blocking.push(`${emp.name} a des éléments à exporter mais aucun matricule Silae.`);
    }
    for (const a of emp.anomalies) {
      const when = a.weekStart.toISOString().slice(0, 10);
      warningSet.add(
        a.kind === "heures_hebdo_excessives"
          ? `${emp.name}, semaine du ${when} : ${a.detail}.`
          : `${emp.name}, semaine du ${when} : valeur négative (${a.detail}).`
      );
    }

    return {
      userId: emp.userId, name: emp.name, matricule: emp.matricule,
      monthHours: emp.monthHours, lines: reportLines, anomalies: emp.anomalies,
    };
  });

  // Rubriques connues du CRM mais sans code paramétré : signalées une fois,
  // même si aucun salarié ne les porte ce mois-ci.
  for (const def of RUBRIQUES) {
    const m = byRubrique.get(def.key);
    if ((m?.exported ?? def.defaultExported) && !(m?.silaeCode ?? def.defaultCode).trim()) {
      warningSet.add(`« ${def.label} » n'a pas de code Silae paramétré.`);
    }
  }

  return {
    report: {
      ...context,
      employees: reportEmployees,
      blocking,
      warnings: Array.from(warningSet).sort(),
      reminders: [
        "Les saisies sur salaire, changements de RIB et d'adresse ne passent pas par cet import : à traiter directement dans Silae.",
        "Les absences et congés payés ne sont pas encore exportés : le format de fichier Silae doit être récupéré auprès du gestionnaire de paie.",
        "Les heures fériées chômées ne sont pas calculées par le CRM : à saisir à la main si elles s'appliquent.",
      ],
      lineCount: lines.length,
    },
    lines,
  };
}

export function rubriqueLabel(key: string): string {
  return RUBRIQUE_BY_KEY.get(key)?.label ?? key;
}
