/**
 * Juillet 2026 de bout en bout : de la base de données au fichier CSV.
 *
 * Complète tests/silae-juillet-2026.test.ts, qui n'éprouve que le calcul.
 * Ici, la chaîne réelle est parcourue — lecture des pointages (collectMonth),
 * contrôle d'accès, rapport, encodage du fichier — sur un espace jetable créé
 * puis supprimé par le test, afin qu'aucune donnée existante n'interfère.
 *
 * Cas couverts, un salarié par situation :
 *   ALPHA   trois semaines pleines dont le 14 juillet (férié), un acompte ;
 *   BRAVO   semaine à cheval juin/juillet, 40 h ;
 *   CHARLIE deux chantiers, chacun avec frais SNCF et retenue de chambre ;
 *   DELTA   des heures, aucun matricule : doit BLOQUER la génération.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// revalidatePath exige le contexte d'une requête Next, qui n'existe pas dans
// un processus de test. Ce test porte sur la validation, l'écriture et
// l'export — pas sur l'invalidation de cache, qui n'a de sens qu'en requête.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import { previewSilaeExport, generateSilaeExport } from "@/server/silae/actions";
import { upsertPointageEntry } from "@/server/pointage/actions";
import type { AuthContext } from "@/server/auth/session";

const SLUG = "__test__silae_juillet_2026";
const MAIL = (k: string) => `__test__silae_${k}@example.invalid`;

function days(monday: string, perDay: Array<number | null>) {
  const base = new Date(`${monday}T00:00:00Z`);
  return perDay.map((v, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: v ?? 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
}

const FULL = [7, 7, 7, 7, 7, null, null];

let crmId = "";
let ctx: AuthContext;
const userIds: Record<string, string> = {};

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");

  const admin = await prisma.user.create({
    data: {
      email: MAIL("admin"),
      firstName: "Test",
      lastName: "Admin",
      passwordHash,
      isGlobalAdmin: true,
      mustChangePassword: false,
    },
  });
  ctx = {
    sessionId: "__test__session",
    user: {
      id: admin.id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      isGlobalAdmin: true,
      status: admin.status,
      color: admin.color,
      avatarUrl: admin.avatarUrl,
      theme: admin.theme,
      mustChangePassword: false,
    },
  };

  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test Silae Juillet" } });
  crmId = crm.id;

  for (const [key, last, matricule] of [
    ["alpha", "ALPHA", "1001"],
    ["bravo", "BRAVO", "1002"],
    ["charlie", "CHARLIE", "1003"],
    ["delta", "DELTA", null],
  ] as const) {
    const u = await prisma.user.create({
      data: { email: MAIL(key), firstName: "Test", lastName: last, passwordHash, mustChangePassword: false },
    });
    userIds[key] = u.id;
    await prisma.userCrmAccess.create({
      data: { userId: u.id, crmId, category: "OUVRIER", silaeMatricule: matricule },
    });
  }

  const chantiers: Record<string, string> = {};
  for (const [name, managementBonus] of [["C1", 100], ["C2", 50]] as const) {
    const c = await prisma.chantier.create({
      data: {
        crmId,
        name,
        startDate: new Date("2026-06-01T00:00:00Z"),
        endDate: new Date("2026-08-31T00:00:00Z"),
        createdById: admin.id,
        lunchAllowance: 20,
        managementBonus,
      },
    });
    chantiers[name] = c.id;
  }

  const assign = (chantierId: string, userId: string, extra: Record<string, number> = {}) =>
    prisma.chantierAssignment.create({ data: { chantierId, userId, ...extra } });
  for (const k of ["alpha", "bravo", "delta"]) await assign(chantiers.C1!, userIds[k]!);
  await assign(chantiers.C1!, userIds.charlie!, { sncfExpense: 120, roomDeduction: 50 });
  await assign(chantiers.C2!, userIds.charlie!, { sncfExpense: 80, roomDeduction: 30 });

  const sheets: Array<[string, string, string, Array<number | null>]> = [
    ["alpha", "C1", "2026-07-06", FULL],
    ["alpha", "C1", "2026-07-13", FULL],
    ["alpha", "C1", "2026-07-20", FULL],
    ["bravo", "C1", "2026-06-29", [8, 8, 8, 8, 8, null, null]],
    ["charlie", "C1", "2026-07-06", FULL],
    ["charlie", "C2", "2026-07-20", FULL],
    ["delta", "C1", "2026-07-06", FULL],
  ];
  for (const [who, chantier, monday, perDay] of sheets) {
    await prisma.pointage.create({
      data: {
        crmId,
        chantierId: chantiers[chantier]!,
        employeeId: userIds[who]!,
        foremanId: admin.id,
        weekStart: new Date(`${monday}T00:00:00Z`),
        days: days(monday, perDay),
        hourlyRate: 12,
        nightRatePercent: 25,
        dirtAllowance: 5,
        lunchAllowanceApplied: true,
        managementBonusApplied: true,
      },
    });
  }

  await prisma.absence.create({
    data: {
      crmId,
      userId: userIds.bravo!,
      type: "CONGE_PAYE",
      startDate: new Date("2026-07-06T00:00:00Z"),
      endDate: new Date("2026-07-10T00:00:00Z"),
      days: 5,
      createdById: admin.id,
    },
  });

  await prisma.acompte.create({
    data: {
      crmId,
      userId: userIds.alpha!,
      amount: 300,
      paidOn: new Date("2026-07-15T00:00:00Z"),
      payrollMonth: new Date(Date.UTC(2026, 6, 1)),
      createdById: admin.id,
    },
  });
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__silae_" } } });
});

describe("juillet 2026, de la base au fichier", () => {
  it("retient les quatre salariés du mois, semaine à cheval comprise", async () => {
    const { ok, report } = await previewSilaeExport(crmId, 2026, 7, { exportWorkedHours: true }, ctx);
    expect(ok).toBe(true);
    expect(report!.employees.map((e) => e.name).sort()).toEqual([
      "Test ALPHA",
      "Test BRAVO",
      "Test CHARLIE",
      "Test DELTA",
    ]);
  });

  it("ALPHA : 105 h, le 14 juillet férié, 15 repas, 300 € d'acompte", async () => {
    const { report } = await previewSilaeExport(crmId, 2026, 7, { exportWorkedHours: true }, ctx);
    const alpha = report!.employees.find((e) => e.name === "Test ALPHA")!;
    const value = (key: string) => alpha.lines.find((l) => l.rubrique === key)?.value;

    expect(alpha.monthHours).toBe(105);
    expect(value("heuresTravaillees")).toBe(105);
    expect(value("heuresFerie")).toBe(7);
    expect(value("repasMidi")).toBe(15);
    expect(value("primeManagement")).toBe(300);
    expect(value("acompte")).toBe(300);
  });

  it("BRAVO : la semaine à cheval ne verse que ses jours de juillet, mais toutes ses heures sup", async () => {
    const { report } = await previewSilaeExport(crmId, 2026, 7, { exportWorkedHours: true }, ctx);
    const bravo = report!.employees.find((e) => e.name === "Test BRAVO")!;
    const value = (key: string) => bravo.lines.find((l) => l.rubrique === key)?.value;

    expect(value("heuresTravaillees")).toBe(24); // mer 1er au ven 3 juillet
    expect(value("hs25")).toBe(5); // 40 h sur la semaine, rattachées à juillet
    expect(value("repasMidi")).toBe(3);
  });

  it("CHARLIE : les frais des DEUX chantiers s'additionnent", async () => {
    const { report } = await previewSilaeExport(crmId, 2026, 7, {}, ctx);
    const charlie = report!.employees.find((e) => e.name === "Test CHARLIE")!;
    const value = (key: string) => charlie.lines.find((l) => l.rubrique === key)?.value;

    expect(value("fraisSncf")).toBe(200);
    expect(value("retenueChambre")).toBe(80);
  });

  it("nomme les absences du mois, qui ne passent pas par cet import", async () => {
    // Sans cette liste, un congé saisi dans le CRM disparaît de la paie sans
    // que personne ne s'en aperçoive : l'export des absences n'existe pas.
    const { report } = await previewSilaeExport(crmId, 2026, 7, {}, ctx);
    expect(report!.reminders).toContain("Test BRAVO : Congé payé, du 2026-07-06 au 2026-07-10 — 5 j.");
  });

  it("les grands déplacements saisis par le chef se retrouvent dans l'export", async () => {
    // Ces deux colonnes existaient en base et étaient lues par l'export, mais
    // aucune saisie ne les alimentait : les rubriques restaient à zéro et ne
    // figuraient jamais dans le fichier. On repasse ici par la vraie action
    // de saisie, pas par une écriture directe en base.
    const chantier = await prisma.chantier.findFirstOrThrow({ where: { crmId, name: "C1" } });
    const fd = new FormData();
    fd.set("employeeId", userIds.alpha!);
    fd.set("weekStart", new Date("2026-07-06T00:00:00Z").toISOString());
    fd.set("days", JSON.stringify(days("2026-07-06", FULL)));
    fd.set("hourlyRate", "12");
    fd.set("nightRatePercent", "25");
    fd.set("dirtAllowance", "5");
    fd.set("lunchAllowanceApplied", "true");
    fd.set("managementBonusApplied", "true");
    fd.set("gdDepl53Count", "3");
    fd.set("gdDepl80Count", "2");

    const res = await upsertPointageEntry(crmId, chantier.id, fd, ctx);
    expect(res.ok).toBe(true);
    // La fiche existait déjà : c'est une mise à jour, pas une création.
    expect(res.created).toBe(false);

    const { report } = await previewSilaeExport(crmId, 2026, 7, {}, ctx);
    const alpha = report!.employees.find((e) => e.name === "Test ALPHA")!;
    const val = (cle: string) => alpha.lines.find((l) => l.rubrique === cle)?.value;
    expect(val("grandDeplacement53")).toBe(3);
    expect(val("grandDeplacement80")).toBe(2);

    const codes = alpha.lines.filter((l) => l.rubrique.startsWith("grandDeplacement")).map((l) => l.code);
    expect(codes.sort()).toEqual(["EV-GdDepl53", "EV-GdDepl80"]);
  });

  it("DELTA sans matricule bloque la génération du fichier", async () => {
    const preview = await previewSilaeExport(crmId, 2026, 7, {}, ctx);
    expect(preview.report!.blocking).toEqual([
      "Test DELTA a des éléments à exporter mais aucun matricule Silae.",
    ]);

    const generated = await generateSilaeExport(crmId, 2026, 7, {}, ctx);
    expect(generated.ok).toBe(false);
    expect(generated.contentBase64).toBeUndefined();
  });

  it("une fois le matricule renseigné, le fichier est produit au format Silae", async () => {
    await prisma.userCrmAccess.update({
      where: { userId_crmId: { userId: userIds.delta!, crmId } },
      data: { silaeMatricule: "1004" },
    });

    const res = await generateSilaeExport(crmId, 2026, 7, { encoding: "win1252" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.fileName).toBe("IMPORT_SILAE_TEST-SILAE-JUILLET_2026-07.csv");

    const csv = Buffer.from(res.contentBase64!, "base64").toString("latin1");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Matricule;Code;Valeur");
    for (const line of lines.slice(1)) {
      expect(line.split(";")).toHaveLength(3);
      // Aucune ligne à zéro ne doit être écrite.
      expect(line.split(";")[2]).not.toBe("0");
    }
    // Les valeurs attendues de chaque salarié se retrouvent telles quelles.
    expect(lines).toContain("1001;EV-Hferie;7");
    expect(lines).toContain("1001;EV-RepasMidi;15");
    expect(lines).toContain("1001;EV-Acompte;300");
    expect(lines).toContain("1002;HS25;5");
    expect(lines).toContain("1003;EV-FraisSNCF;200");
    expect(lines).toContain("1004;EV-RepasMidi;5");
  });
});
