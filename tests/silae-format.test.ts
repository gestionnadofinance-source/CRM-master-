/**
 * Format du fichier d'import Silae et calculs qui l'alimentent.
 *
 * Tests purs (aucune base) sur les trois briques du nouvel export :
 * calendrier des jours fériés, répartition des heures supplémentaires, et
 * écriture du CSV. Le format est imposé par Silae et une erreur y est
 * SILENCIEUSE — un code ou une décimale mal formés n'y produisent aucun
 * message, la valeur est simplement ignorée. D'où le niveau de détail ici.
 */
import { describe, expect, it } from "vitest";
import { easterSunday, frenchHolidays, isFrenchHoliday } from "@/server/silae/holidays";
import { splitWeeklyOvertime } from "@/server/silae/overtime";
import { formatSilaeNumber, mergeSilaeLines, renderSilaeCsv, encodeSilaeCsv, silaeFileName } from "@/server/silae/csv";

describe("jours fériés français", () => {
  it("calcule Pâques sur des années de référence connues", () => {
    // Dates vérifiables indépendamment (éphémérides publiques).
    expect(easterSunday(2024).toISOString().slice(0, 10)).toBe("2024-03-31");
    expect(easterSunday(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });

  it("place correctement les fériés mobiles de 2026", () => {
    const h = frenchHolidays(2026);
    expect(h.has("2026-04-06")).toBe(true); // lundi de Pâques
    expect(h.has("2026-05-14")).toBe(true); // Ascension
    expect(h.has("2026-05-25")).toBe(true); // lundi de Pentecôte
  });

  it("retient les 11 jours fériés de France métropolitaine", () => {
    expect(frenchHolidays(2026).size).toBe(11);
  });

  it("reconnaît un férié fixe et écarte un jour ordinaire", () => {
    expect(isFrenchHoliday("2026-07-14")).toBe(true);
    expect(isFrenchHoliday("2026-12-25")).toBe(true);
    expect(isFrenchHoliday("2026-07-15")).toBe(false);
  });
});

describe("heures supplémentaires", () => {
  it("ne compte aucune heure sup jusqu'à 35 h", () => {
    expect(splitWeeklyOvertime(35)).toEqual({ hs25: 0, hs50: 0 });
    expect(splitWeeklyOvertime(20)).toEqual({ hs25: 0, hs50: 0 });
  });

  it("majore à 25 % les 8 premières heures au-delà de 35 h", () => {
    expect(splitWeeklyOvertime(39)).toEqual({ hs25: 4, hs50: 0 });
    expect(splitWeeklyOvertime(43)).toEqual({ hs25: 8, hs50: 0 });
  });

  it("bascule à 50 % au-delà de la huitième heure supplémentaire", () => {
    expect(splitWeeklyOvertime(45)).toEqual({ hs25: 8, hs50: 2 });
    expect(splitWeeklyOvertime(50)).toEqual({ hs25: 8, hs50: 7 });
  });

  it("gère les demi-heures sans dérive de virgule flottante", () => {
    expect(splitWeeklyOvertime(37.5)).toEqual({ hs25: 2.5, hs50: 0 });
    expect(splitWeeklyOvertime(43.25)).toEqual({ hs25: 8, hs50: 0.25 });
  });
});

describe("format du CSV Silae", () => {
  it("écrit les décimales avec une virgule, sans séparateur de milliers", () => {
    expect(formatSilaeNumber(2693.04)).toBe("2693,04");
    expect(formatSilaeNumber(128.24)).toBe("128,24");
    expect(formatSilaeNumber(15)).toBe("15");
  });

  it("arrondit à 2 décimales et n'expose jamais de dérive binaire", () => {
    expect(formatSilaeNumber(0.1 + 0.2)).toBe("0,3");
    expect(formatSilaeNumber(1.005)).toBe("1");
    expect(formatSilaeNumber(12.3456)).toBe("12,35");
  });

  it("additionne les doublons (même matricule + même code) en une seule ligne", () => {
    const merged = mergeSilaeLines([
      { matricule: "00012", code: "HS25", value: 4 },
      { matricule: "00012", code: "HS25", value: 3.5 },
      { matricule: "00013", code: "HS25", value: 2 },
    ]);
    expect(merged).toEqual([
      { matricule: "00012", code: "HS25", value: 7.5 },
      { matricule: "00013", code: "HS25", value: 2 },
    ]);
  });

  it("écarte les lignes dont la valeur est nulle, y compris après addition", () => {
    const merged = mergeSilaeLines([
      { matricule: "00012", code: "EV-Acompte", value: 300 },
      { matricule: "00012", code: "EV-Acompte", value: -300 },
      { matricule: "00013", code: "EV-Voyage", value: 0 },
      { matricule: "00014", code: "EV-IndKm", value: 12 },
    ]);
    expect(merged).toEqual([{ matricule: "00014", code: "EV-IndKm", value: 12 }]);
  });

  it("produit exactement l'en-tête et les 3 colonnes attendues", () => {
    const csv = renderSilaeCsv([
      { matricule: "00012", code: "HS25", value: 15 },
      { matricule: "00012", code: "EV-IndKm", value: 2693.04 },
      { matricule: "00012", code: "EV-RepasMidi", value: 21 },
    ]);
    expect(csv).toBe(
      "Matricule;Code;Valeur\r\n00012;HS25;15\r\n00012;EV-IndKm;2693,04\r\n00012;EV-RepasMidi;21\r\n"
    );
    // Aucune ligne vide, et jamais plus de 3 colonnes.
    for (const line of csv.split("\r\n").filter(Boolean)) {
      expect(line.split(";")).toHaveLength(3);
    }
  });

  it("conserve les zéros en tête du matricule", () => {
    expect(renderSilaeCsv([{ matricule: "00012", code: "HS25", value: 1 }])).toContain("\r\n00012;");
  });

  it("encode les accents en Windows-1252, pas en UTF-8", () => {
    const ansi = encodeSilaeCsv("é", "win1252");
    expect(ansi).toHaveLength(1);
    expect(ansi[0]).toBe(0xe9);
    // Le même texte en UTF-8 occupe deux octets : c'est exactement la
    // confusion qui fait apparaître « Ã© » dans Silae.
    expect(encodeSilaeCsv("é", "utf8")).toHaveLength(2);
  });

  it("nomme le fichier selon la convention demandée", () => {
    expect(silaeFileName("Fidem Froid Clim", 2026, 7)).toBe("IMPORT_SILAE_FIDEM-FROID-CLIM_2026-07.csv");
  });
});
