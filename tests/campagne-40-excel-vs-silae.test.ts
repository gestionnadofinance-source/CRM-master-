/**
 * Campagne à l'échelle, EN PROCESSUS : 40 salariés, 10 chantiers, un mois.
 *
 * Le tableau Excel de chaque salarié et l'export Silae du mois doivent
 * raconter la même chose. Les deux sont produits par les VRAIS chemins de
 * production, sur les mêmes pointages en base :
 *   - Excel  : buildEmployeeAccountingWorkbook (le même que generateAccountingExport) ;
 *   - Silae  : previewSilaeExportCore (collectMonth + aggregate + rapport).
 *
 * Aucune divergence n'est tolérée : chaque rubrique est comparée colonne à
 * colonne, salarié par salarié. Les unités et périodicités confirmées par le
 * gestionnaire sont vérifiées ici — repas en NOMBRE, masque/zone/poste PAR
 * JOUR, management/logement/habillage forfaitaires à la semaine, habillage en
 * euros.
 *
 * Ce test remplace l'ancienne version qui lisait des classeurs générés par le
 * navigateur : lent, flou et dépendant d'un serveur lancé à la main.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import { buildEmployeeAccountingWorkbook } from "@/server/accounting/core";
import { previewSilaeExportCore } from "@/server/silae/core";
import type { SilaeReport } from "@/server/silae/report";
import type { AuthContext } from "@/server/auth/session";
import type { Chantier, ChantierAssignment, Pointage } from "@prisma/client";

const SLUG = "__test__campagne40";
const NB_SALARIES = 40;
const NB_CHANTIERS = 10;
// Semaines de juillet 2026. La dernière (27/07) déborde sur août par ses
// samedi/dimanche, jamais travaillés ici : la concordance reste donc exacte.
const SEMAINES = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"];

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

/** Profils d'heures : Mon-Ven, avec variantes nuit/dimanche/férié DANS juillet. */
function heuresProfil(profil: number, lundi: string): number[][] {
  // [normal, matin, apresMidi, nuit] pour chaque jour lun→dim.
  const j = (n: number) => [n, 0, 0, 0];
  const base = [j(7), j(7), j(7), j(7), j(7), j(0), j(0)];
  if (profil === 1) return [j(8), j(8), j(8), j(8), j(8), j(0), j(0)]; // 40 h → heures sup
  if (profil === 2) {
    // Nuit le jeudi, dimanche travaillé (dimanche 12/07 pour la semaine du 06).
    const d = [j(7), j(7), j(7), [0, 0, 0, 8], j(7), j(0), j(6)];
    return lundi === "2026-07-06" ? d : base;
  }
  return base;
}

function joursDe(lundi: string, profil: number) {
  const base = new Date(`${lundi}T00:00:00Z`);
  return heuresProfil(profil, lundi).map((h, i) => {
    const dte = new Date(base);
    dte.setUTCDate(dte.getUTCDate() + i);
    return { date: dte.toISOString().slice(0, 10), normal: h[0]!, matin: h[1]!, apresMidi: h[2]!, nuit: h[3]! };
  });
}

let ctx: AuthContext;
let crmId = "";
let report: SilaeReport | null = null;
// Par salarié : son classeur relu et son chantier/affectation/pointages.
const parSalarie = new Map<
  string,
  { nom: string; ws: ExcelJS.Worksheet }
>();

/** Somme d'une colonne sur les seules lignes de JOUR (col B = lettre de jour). */
function sommeJours(ws: ExcelJS.Worksheet, col: number): number {
  let t = 0;
  ws.eachRow((row, n) => {
    if (n < 3) return;
    const b = row.getCell(2).value;
    if (typeof b !== "string" || !/^[LMJVSD]$/.test(b)) return;
    const v = row.getCell(col).value;
    if (typeof v === "number") t += v;
  });
  return Math.round(t * 100) / 100;
}

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");
  const admin = await prisma.user.create({
    data: { email: "__test__c40_admin@example.invalid", firstName: "Test", lastName: "Admin", passwordHash, isGlobalAdmin: true, mustChangePassword: false },
  });
  ctx = {
    sessionId: "x",
    user: { id: admin.id, firstName: admin.firstName, lastName: admin.lastName, email: admin.email, isGlobalAdmin: true, status: admin.status, color: admin.color, avatarUrl: admin.avatarUrl, theme: admin.theme, mustChangePassword: false },
  };
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Campagne 40" } });
  crmId = crm.id;

  // 10 chantiers : masque/zone/poste JOURNALIERS, management/habillage HEBDO.
  const chantiers: Chantier[] = [];
  for (let i = 1; i <= NB_CHANTIERS; i++) {
    chantiers.push(
      await prisma.chantier.create({
        data: {
          crmId, name: `QA-C${deuxChiffres(i)}`,
          startDate: new Date("2026-06-01T00:00:00Z"), endDate: new Date("2026-08-31T00:00:00Z"),
          createdById: admin.id,
          lunchAllowance: 20, dinnerAllowance: 15, mealAllowance: 9.81, travelAllowance: 10 + i,
          managementBonus: 100 + i, clothingBonus: 12,
          maskBonus: 3, zoneBonus: 4, postBonus: 5,
        },
      })
    );
  }

  // 40 salariés, un chantier chacun, matricule pour tous (pas de blocage).
  for (let i = 0; i < NB_SALARIES; i++) {
    const chantier = chantiers[i % NB_CHANTIERS]!;
    const user = await prisma.user.create({
      data: { email: `__test__c40_emp${deuxChiffres(i)}@example.invalid`, firstName: "S", lastName: `EMP${deuxChiffres(i)}`, passwordHash, mustChangePassword: false },
    });
    await prisma.userCrmAccess.create({
      data: { userId: user.id, crmId, category: "OUVRIER", silaeMatricule: String(3000 + i) },
    });
    const assignment = await prisma.chantierAssignment.create({
      data: {
        chantierId: chantier.id, userId: user.id,
        kmRate: 0.5, distanceKm: 10 + (i % 20),
        sncfExpense: i % 5 === 0 ? 120 : 0, roomDeduction: i % 7 === 0 ? 60 : 0,
      },
    });
    const profil = i % 3;
    const pointages: Pointage[] = [];
    for (const lundi of SEMAINES) {
      pointages.push(
        await prisma.pointage.create({
          data: {
            crmId, chantierId: chantier.id, employeeId: user.id, foremanId: admin.id,
            weekStart: new Date(`${lundi}T00:00:00Z`), days: joursDe(lundi, profil),
            hourlyRate: 12, nightRatePercent: 25,
            housingAllowance: i % 3 === 0 ? 40 : 0, dirtAllowance: 0,
            lunchAllowanceApplied: true,
            dinnerAllowanceApplied: profil === 2,
            mealAllowanceApplied: profil !== 0,
            travelAllowanceApplied: i % 2 === 0,
            kmReimbursementApplied: true,
            managementBonusApplied: i % 4 === 0,
            postBonusApplied: i % 2 === 0,
            maskBonusApplied: i % 3 === 0,
            zoneBonusApplied: i % 5 === 0,
            clothingBonusApplied: i % 8 === 0,
            gdDepl53Count: i % 6 === 0 ? 2 : 0,
            gdDepl80Count: i % 9 === 0 ? 1 : 0,
          },
        })
      );
    }

    const buffer = await buildEmployeeAccountingWorkbook(`${user.firstName} ${user.lastName}`, chantier, assignment as ChantierAssignment, pointages);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    parSalarie.set(`${user.firstName} ${user.lastName}`, { nom: `${user.firstName} ${user.lastName}`, ws: wb.worksheets[0]! });
  }

  report = (await previewSilaeExportCore(ctx, crmId, 2026, 7, { exportWorkedHours: true })).report ?? null;
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__c40_" } } });
});

describe("campagne 40 — le tableau Excel et l'export Silae concordent, salarié par salarié", () => {
  it("les 40 salariés sont présents des deux côtés", () => {
    expect(parSalarie.size).toBe(40);
    expect(report).not.toBeNull();
    const nomsSilae = new Set(report!.employees.map((e) => e.name));
    expect(Array.from(parSalarie.keys()).filter((n) => !nomsSilae.has(n))).toEqual([]);
    expect(report!.blocking).toEqual([]); // tous ont un matricule
  });

  it("chaque rubrique concorde exactement, dans la bonne unité et la bonne périodicité", () => {
    const ecarts: string[] = [];

    for (const [nom, { ws }] of parSalarie) {
      const emp = report!.employees.find((e) => e.name === nom)!;
      const silae = (cle: string) => emp.lines.find((l) => l.rubrique === cle)?.value ?? 0;

      // [libellé, colonne Excel, rubrique Silae]
      const comparaisons: Array<[string, () => number, number]> = [
        // Heures : E (non-dimanche) + I (dimanche) + H (nuit) = heures travaillées.
        ["heures", () => sommeJours(ws, 5) + sommeJours(ws, 9) + sommeJours(ws, 8), silae("heuresTravaillees")],
        ["dimanche", () => sommeJours(ws, 9), silae("heuresDimanche")],
        ["nuit", () => sommeJours(ws, 8), silae("heuresNuit")],
        ["férié", () => sommeJours(ws, 10), silae("heuresFerie")],
        // Repas : NOMBRE d'occurrences des deux côtés.
        ["repas midi", () => sommeJours(ws, 13), silae("repasMidi")],
        ["repas soir", () => sommeJours(ws, 14), silae("repasSoir")],
        ["panier", () => sommeJours(ws, 15), silae("panier")],
        // Montants journaliers.
        ["km", () => sommeJours(ws, 11), silae("indemniteKm")],
        ["voyage", () => sommeJours(ws, 24), silae("indemniteTrajet")],
        // Primes JOURNALIÈRES.
        ["poste", () => sommeJours(ws, 21), silae("primePoste")],
        ["masque", () => sommeJours(ws, 22), silae("primeMasque")],
        ["zone", () => sommeJours(ws, 25), silae("primeZone")],
        // Forfaits HEBDOMADAIRES.
        ["management", () => sommeJours(ws, 19), silae("primeManagement")],
        ["logement", () => sommeJours(ws, 18), silae("logement")],
        ["habillage (€)", () => sommeJours(ws, 20), silae("primeHabillage")],
        // Grands déplacements : NOMBRES.
        ["gd depl 53", () => sommeJours(ws, 16), silae("grandDeplacement53")],
        ["gd depl 80", () => sommeJours(ws, 17), silae("grandDeplacement80")],
        // Frais d'affectation, une fois.
        ["frais SNCF", () => sommeJours(ws, 12), silae("fraisSncf")],
        ["retenue chambre", () => sommeJours(ws, 23), silae("retenueChambre")],
      ];

      for (const [libelle, excelFn, silaeVal] of comparaisons) {
        const excel = excelFn();
        if (Math.abs(excel - silaeVal) > 0.001) {
          ecarts.push(`${nom} · ${libelle} : Excel ${excel} ≠ Silae ${silaeVal}`);
        }
      }
    }

    expect(ecarts).toEqual([]);
  });

  it("les colonnes sans source dans le CRM restent vierges (F, G, Z, AA)", () => {
    for (const [nom, { ws }] of parSalarie) {
      for (const [col, lib] of [[6, "F compteur 8h"], [7, "G 0.5"], [26, "Z compteur"], [27, "AA chômés"]] as const) {
        expect(sommeJours(ws, col), `${nom} · ${lib} doit rester vierge`).toBe(0);
      }
    }
  });
});
