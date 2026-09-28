/**
 * Purge du journal d'activité.
 *
 * Défaut relevé en phase d'endurance : une ligne est écrite à chaque
 * opération métier et rien ne l'élaguait, contrairement aux tables de
 * limitation de fréquence. Ce test vérifie les deux moitiés de la règle —
 * ce qui est assez vieux part, ce qui est récent reste — car une purge trop
 * large détruirait un historique qui a de la valeur métier.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { purgeOldActivityLogs } from "@/server/activity";

const SLUG = "__test__purge_journal";
const JOUR_MS = 24 * 60 * 60 * 1000;

let crmId = "";

beforeAll(async () => {
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test Purge" } });
  crmId = crm.id;

  const lignes: Array<{ action: string; age: number }> = [
    { action: "tres_vieux", age: 800 },
    { action: "juste_au_dela", age: 366 },
    { action: "juste_en_deca", age: 364 },
    { action: "recent", age: 1 },
  ];
  for (const l of lignes) {
    await prisma.activityLog.create({
      data: {
        crmId,
        action: l.action,
        entityType: "Test",
        createdAt: new Date(Date.now() - l.age * JOUR_MS),
      },
    });
  }
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
});

describe("purge du journal d'activité", () => {
  it("supprime au-delà de 12 mois et conserve en deçà", async () => {
    const supprimees = await purgeOldActivityLogs();
    expect(supprimees).toBeGreaterThanOrEqual(2);

    const restantes = await prisma.activityLog.findMany({
      where: { crmId },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(restantes.map((r) => r.action)).toEqual(["juste_en_deca", "recent"]);
  });

  it("ne renvoie rien à purger au second passage", async () => {
    // Idempotence : la purge quotidienne ne doit pas retravailler sans cesse
    // les mêmes lignes.
    await purgeOldActivityLogs();
    expect(await purgeOldActivityLogs()).toBe(0);
  });
});
