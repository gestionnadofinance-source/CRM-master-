/**
 * Diff des accès CRM d'un utilisateur (voir src/server/admin/access-diff.ts,
 * extrait de updateUserAccess dans admin/actions.ts) — logique pure, sans
 * base de données : verrouille les règles de classification create/update/
 * delete que la mise à jour d'un utilisateur applique ensuite en base.
 */
import { describe, expect, it } from "vitest";
import { computeAccessDiff, type DesiredAccessEntry, type ExistingAccessRow } from "@/server/admin/access-diff";

function existing(overrides: Partial<ExistingAccessRow> & { crmId: string }): ExistingAccessRow {
  return {
    role: "USER",
    category: "OUVRIER",
    isForeman: false,
    defaultHourlyRate: 0,
    defaultHousingAllowance: 0,
    defaultDirtAllowance: 5,
    ...overrides,
  };
}

function desired(overrides: Partial<DesiredAccessEntry> & { crmId: string }): DesiredAccessEntry {
  return {
    role: "USER",
    category: "OUVRIER",
    isForeman: false,
    defaultHourlyRate: 0,
    defaultHousingAllowance: 0,
    defaultDirtAllowance: 5,
    ...overrides,
  };
}

describe("computeAccessDiff", () => {
  it("classe un CRM absent des accès existants comme une création", () => {
    const diff = computeAccessDiff([], [desired({ crmId: "crm-1" })]);
    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it("ne classe rien du tout quand rien n'a changé", () => {
    const row = existing({ crmId: "crm-1" });
    const diff = computeAccessDiff([row], [desired({ crmId: "crm-1" })]);
    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it("classe un CRM retiré de la matrice désirée comme une suppression", () => {
    const row = existing({ crmId: "crm-1" });
    const diff = computeAccessDiff([row], []);
    expect(diff.toDelete).toEqual([row]);
    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it("classe un changement de rôle comme une mise à jour", () => {
    const row = existing({ crmId: "crm-1", role: "USER" });
    const diff = computeAccessDiff([row], [desired({ crmId: "crm-1", role: "MANAGER" })]);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it("classe un changement de catégorie comme une mise à jour", () => {
    const row = existing({ crmId: "crm-1", category: "OUVRIER" });
    const diff = computeAccessDiff([row], [desired({ crmId: "crm-1", category: "COMMERCIAL" })]);
    expect(diff.toUpdate).toHaveLength(1);
  });

  it("classe un changement de isForeman comme une mise à jour", () => {
    const row = existing({ crmId: "crm-1", isForeman: false });
    const diff = computeAccessDiff([row], [desired({ crmId: "crm-1", isForeman: true })]);
    expect(diff.toUpdate).toHaveLength(1);
  });

  it("classe un changement de taux horaire par défaut comme une mise à jour, en comparant les valeurs numériquement (pas en chaîne)", () => {
    const row = existing({ crmId: "crm-1", defaultHourlyRate: 12.5 });
    // Même valeur numérique, formatage différent (simule un Decimal Prisma) : ne doit PAS déclencher de mise à jour.
    const sameValueDiff = computeAccessDiff([row], [desired({ crmId: "crm-1", defaultHourlyRate: 12.5 })]);
    expect(sameValueDiff.toUpdate).toHaveLength(0);

    const changedDiff = computeAccessDiff([row], [desired({ crmId: "crm-1", defaultHourlyRate: 15 })]);
    expect(changedDiff.toUpdate).toHaveLength(1);
  });

  it("classe un changement de logement ou de salissure par défaut comme une mise à jour", () => {
    const row = existing({ crmId: "crm-1", defaultHousingAllowance: 0, defaultDirtAllowance: 5 });
    expect(computeAccessDiff([row], [desired({ crmId: "crm-1", defaultHousingAllowance: 30 })]).toUpdate).toHaveLength(1);
    expect(computeAccessDiff([row], [desired({ crmId: "crm-1", defaultDirtAllowance: 8 })]).toUpdate).toHaveLength(1);
  });

  it("traite indépendamment plusieurs CRM à la fois (un de chaque catégorie)", () => {
    const keptUnchanged = existing({ crmId: "crm-unchanged" });
    const toBeUpdated = existing({ crmId: "crm-updated", role: "USER" });
    const toBeRemoved = existing({ crmId: "crm-removed" });

    const diff = computeAccessDiff(
      [keptUnchanged, toBeUpdated, toBeRemoved],
      [
        desired({ crmId: "crm-unchanged" }),
        desired({ crmId: "crm-updated", role: "MANAGER" }),
        desired({ crmId: "crm-new" }),
      ]
    );

    expect(diff.toCreate.map((a) => a.crmId)).toEqual(["crm-new"]);
    expect(diff.toUpdate.map((a) => a.crmId)).toEqual(["crm-updated"]);
    expect(diff.toDelete.map((a) => a.crmId)).toEqual(["crm-removed"]);
  });
});
