/**
 * Classement des documents du coffre-fort personnel (src/lib/vault-grouping.ts) :
 * les onglets « Feuilles de pointage » et « Pointage client » regroupent par mois
 * couvert, « Ordres de mission » par chantier, et « Mes documents » ne garde que
 * l'arborescence libre.
 */
import { describe, expect, it } from "vitest";
import {
  isAutoCategory,
  groupByMonth,
  groupByChantier,
  foldersForFreeTree,
  type GroupableDocument,
} from "@/lib/vault-grouping";

function doc(over: Partial<GroupableDocument> & { id: string }): GroupableDocument {
  return {
    category: "TIMESHEET_EMPLOYEE",
    folderId: null,
    createdAt: new Date("2026-06-15T10:00:00Z"),
    periodStart: null,
    chantier: null,
    ...over,
  };
}

describe("isAutoCategory", () => {
  it("désigne les trois natures présentées dans un onglet dédié", () => {
    expect(isAutoCategory("TIMESHEET_EMPLOYEE")).toBe(true);
    expect(isAutoCategory("MISSION_ORDER")).toBe(true);
    expect(isAutoCategory("TIMESHEET_CLIENT")).toBe(true);
  });

  it("laisse les fiches de paie et documents libres à l'arborescence", () => {
    expect(isAutoCategory("PAYSLIP")).toBe(false);
    expect(isAutoCategory("DOCUMENT")).toBe(false);
    expect(isAutoCategory("ACCOUNTING_EXPORT")).toBe(false);
  });
});

describe("groupByMonth", () => {
  it("classe sur le mois COUVERT, pas sur la date de dépôt", () => {
    // Fiche de la semaine du 3 mars, déposée le 2 avril : elle appartient à mars.
    const groups = groupByMonth([
      doc({ id: "a", periodStart: new Date("2026-03-03T00:00:00Z"), createdAt: new Date("2026-04-02T09:00:00Z") }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("2026-03");
  });

  it("retombe sur la date de dépôt quand la période n'est pas enregistrée", () => {
    const groups = groupByMonth([doc({ id: "a", periodStart: null, createdAt: new Date("2026-04-02T09:00:00Z") })]);
    expect(groups[0]!.key).toBe("2026-04");
  });

  it("ordonne du mois le plus récent au plus ancien, y compris à cheval sur une année", () => {
    const groups = groupByMonth([
      doc({ id: "a", periodStart: new Date("2025-12-01T00:00:00Z") }),
      doc({ id: "b", periodStart: new Date("2026-01-05T00:00:00Z") }),
      doc({ id: "c", periodStart: new Date("2026-02-02T00:00:00Z") }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });

  it("rassemble dans un seul groupe deux semaines du même mois", () => {
    const groups = groupByMonth([
      doc({ id: "a", periodStart: new Date("2026-03-03T00:00:00Z") }),
      doc({ id: "b", periodStart: new Date("2026-03-24T00:00:00Z") }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.docs.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("accepte une date sérialisée en chaîne (traversée serveur → client)", () => {
    const groups = groupByMonth([doc({ id: "a", periodStart: "2026-03-03T00:00:00.000Z" })]);
    expect(groups[0]!.key).toBe("2026-03");
  });

  it("nomme le groupe en français", () => {
    const groups = groupByMonth([doc({ id: "a", periodStart: new Date("2026-03-03T00:00:00Z") })]);
    expect(groups[0]!.label).toMatch(/mars 2026/i);
  });
});

describe("groupByChantier", () => {
  const nord = { id: "c1", name: "Chantier Nord" };
  const sud = { id: "c2", name: "Atelier Sud" };

  it("regroupe par chantier, par ordre alphabétique", () => {
    const groups = groupByChantier([
      doc({ id: "a", category: "MISSION_ORDER", chantier: nord }),
      doc({ id: "b", category: "MISSION_ORDER", chantier: sud }),
      doc({ id: "c", category: "MISSION_ORDER", chantier: nord }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Atelier Sud", "Chantier Nord"]);
    expect(groups[1]!.docs.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("relègue en fin de liste les documents sans chantier enregistré", () => {
    const groups = groupByChantier([
      doc({ id: "orphelin", category: "MISSION_ORDER", chantier: null }),
      doc({ id: "b", category: "MISSION_ORDER", chantier: nord }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Chantier Nord", "Chantier non renseigné"]);
  });
});

describe("foldersForFreeTree", () => {
  it("masque un dossier ne contenant que du déposé automatique", () => {
    const folders = [{ id: "semaine", parentId: null }];
    const documents = [doc({ id: "a", category: "TIMESHEET_EMPLOYEE", folderId: "semaine" })];
    expect(foldersForFreeTree(folders, documents)).toEqual([]);
  });

  it("garde un dossier vide — celui que le propriétaire vient de créer", () => {
    const folders = [{ id: "nouveau", parentId: null }];
    expect(foldersForFreeTree(folders, [])).toHaveLength(1);
  });

  it("garde un dossier dès qu'il contient un document libre", () => {
    const folders = [{ id: "perso", parentId: null }];
    const documents = [
      doc({ id: "a", category: "TIMESHEET_EMPLOYEE", folderId: "perso" }),
      doc({ id: "b", category: "PAYSLIP", folderId: "perso" }),
    ];
    expect(foldersForFreeTree(folders, documents).map((f) => f.id)).toEqual(["perso"]);
  });

  it("garde un dossier parent dont seul un sous-dossier contient un document libre", () => {
    const folders = [
      { id: "parent", parentId: null },
      { id: "enfant", parentId: "parent" },
    ];
    const documents = [doc({ id: "a", category: "DOCUMENT", folderId: "enfant" })];
    expect(foldersForFreeTree(folders, documents).map((f) => f.id).sort()).toEqual(["enfant", "parent"]);
  });

  it("masque tout un sous-arbre purement automatique", () => {
    const folders = [
      { id: "parent", parentId: null },
      { id: "enfant", parentId: "parent" },
    ];
    const documents = [doc({ id: "a", category: "MISSION_ORDER", folderId: "enfant" })];
    expect(foldersForFreeTree(folders, documents)).toEqual([]);
  });
});
