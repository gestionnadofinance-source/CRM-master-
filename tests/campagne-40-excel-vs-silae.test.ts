/**
 * Campagne à l'échelle : le tableau Excel de chaque salarié et l'import Silae
 * du mois doivent raconter la même chose.
 *
 * Les deux fichiers sont produits par des chemins différents — l'Excel à
 * partir des fiches déposées au coffre-fort, semaine par semaine ; le CSV à
 * partir des pointages, mois par mois. C'est précisément parce qu'ils ne
 * partagent pas leur code qu'il faut les confronter.
 *
 * UN ÉCART EST ATTENDU ET VÉRIFIÉ, pas toléré : l'Excel couvre des SEMAINES
 * entières, l'export Silae un MOIS. La semaine du 27 juillet 2026 déborde sur
 * août pour qui travaille le samedi ou le dimanche. Le test ne se contente
 * donc pas de constater une différence : il exige qu'elle vaille exactement
 * les heures travaillées en août.
 *
 * Ce fichier s'appuie sur le jeu de campagne (scripts/qa/seed-campagne-40.ts,
 * puis dépôts et génération Excel par l'interface). Sans lui, il se déclare
 * ignoré plutôt que de rougir à tort.
 */
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { previewSilaeExport } from "@/server/silae/actions";
import type { AuthContext } from "@/server/auth/session";
import type { SilaeReport } from "@/server/silae/report";

const CRM_SLUG = "fidem-froid-clim";
const ANNEE = 2026;
const MOIS = 7;

interface Attendu {
  nom: string;
  /** Heures travaillées tombant en août : l'écart légitime entre les deux fichiers. */
  heuresAout: number;
  heuresDimancheAout: number;
  heuresNuitAout: number;
  joursTravaillesAout: number;
}

let ctx: AuthContext | null = null;
let crmId = "";
let rapport: SilaeReport | null = null;
const classeurs = new Map<string, ExcelJS.Worksheet>();
const attendus = new Map<string, Attendu>();

/**
 * Somme une colonne sur les seules lignes de JOURS : une ligne de données
 * porte la lettre du jour en colonne B et le quantième en colonne C. Les
 * lignes « sous total » et « TOTAL » portent des formules qu'ExcelJS ne
 * calcule pas et feraient double emploi.
 */
function sommeColonne(ws: ExcelJS.Worksheet, col: number): number {
  let total = 0;
  ws.eachRow((row, numero) => {
    if (numero < 3) return;
    const lettre = row.getCell(2).value;
    const quantieme = row.getCell(3).value;
    if (typeof lettre !== "string" || !/^[LMJVSD]$/.test(lettre)) return;
    if (typeof quantieme !== "number") return;
    const v = row.getCell(col).value;
    if (typeof v === "number") total += v;
  });
  return Math.round(total * 100) / 100;
}

beforeAll(async () => {
  const crm = await prisma.crm.findUnique({ where: { slug: CRM_SLUG } });
  if (!crm) return;
  crmId = crm.id;

  const admin = await prisma.user.findUnique({ where: { email: "qa.admin@qa.local" } });
  const exports = await prisma.vaultDocument.findMany({
    where: { crmId, category: "ACCOUNTING_EXPORT" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!admin || exports.length === 0) return;

  ctx = {
    sessionId: "__test__campagne",
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

  const driver = getStorageDriver();
  for (const doc of exports) {
    const buffer = await driver.get(doc.storageKey);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const nom = `${doc.user.firstName} ${doc.user.lastName}`.trim();
    if (ws) classeurs.set(nom, ws);

    // Heures d'août portées par les semaines de ce salarié : c'est l'écart
    // que l'Excel doit avoir en plus par rapport au mois de juillet.
    const pointages = await prisma.pointage.findMany({ where: { crmId, employeeId: doc.user.id } });
    let heuresAout = 0;
    let dimancheAout = 0;
    let nuitAout = 0;
    let joursAout = 0;
    for (const p of pointages) {
      for (const j of (p.days as Array<{ date: string; normal: number; matin: number; apresMidi: number; nuit: number }>) ?? []) {
        if (!j.date.startsWith("2026-08")) continue;
        const total = (j.normal || 0) + (j.matin || 0) + (j.apresMidi || 0) + (j.nuit || 0);
        if (total <= 0) continue;
        heuresAout += total;
        joursAout += 1;
        nuitAout += j.nuit || 0;
        if (new Date(`${j.date}T00:00:00Z`).getUTCDay() === 0) dimancheAout += total;
      }
    }
    attendus.set(nom, {
      nom,
      heuresAout: Math.round(heuresAout * 100) / 100,
      heuresDimancheAout: Math.round(dimancheAout * 100) / 100,
      heuresNuitAout: Math.round(nuitAout * 100) / 100,
      joursTravaillesAout: joursAout,
    });
  }

  const res = await previewSilaeExport(crmId, ANNEE, MOIS, { exportWorkedHours: true }, ctx);
  rapport = res.report ?? null;
});

describe("campagne 40 salariés — le tableau Excel et l'import Silae concordent", () => {
  it("le jeu de campagne est présent", () => {
    if (classeurs.size === 0) {
      console.warn("Jeu de campagne absent : lancer scripts/qa/seed-campagne-40.ts puis les scripts de dépôt et de génération.");
    }
    expect(classeurs.size === 0 || classeurs.size === 40).toBe(true);
  });

  it("chaque salarié a son classeur et sa ligne dans le rapport Silae", () => {
    if (classeurs.size === 0) return;
    expect(rapport).not.toBeNull();
    const nomsSilae = new Set(rapport!.employees.map((e) => e.name));
    const manquants = Array.from(classeurs.keys()).filter((n) => !nomsSilae.has(n));
    expect(manquants).toEqual([]);
  });

  it("les heures concordent, au débordement d'août près", () => {
    if (classeurs.size === 0) return;
    const ecarts: string[] = [];

    for (const [nom, ws] of classeurs) {
      const emp = rapport!.employees.find((e) => e.name === nom);
      if (!emp) continue;
      const val = (cle: string) => emp.lines.find((l) => l.rubrique === cle)?.value ?? 0;
      const att = attendus.get(nom)!;

      const heuresExcel = sommeColonne(ws, 5) + sommeColonne(ws, 9) + sommeColonne(ws, 8); // E + I + H
      const ecart = Math.round((heuresExcel - val("heuresTravaillees")) * 100) / 100;
      if (ecart !== att.heuresAout) {
        ecarts.push(`${nom} : Excel ${heuresExcel} h − Silae ${val("heuresTravaillees")} h = ${ecart}, attendu ${att.heuresAout} (heures d'août)`);
      }

      const dimEcart = Math.round((sommeColonne(ws, 9) - val("heuresDimanche")) * 100) / 100;
      if (dimEcart !== att.heuresDimancheAout) {
        ecarts.push(`${nom} : dimanche Excel ${sommeColonne(ws, 9)} − Silae ${val("heuresDimanche")} = ${dimEcart}, attendu ${att.heuresDimancheAout}`);
      }

      const nuitEcart = Math.round((sommeColonne(ws, 8) - val("heuresNuit")) * 100) / 100;
      if (nuitEcart !== att.heuresNuitAout) {
        ecarts.push(`${nom} : nuit Excel ${sommeColonne(ws, 8)} − Silae ${val("heuresNuit")} = ${nuitEcart}, attendu ${att.heuresNuitAout}`);
      }
    }

    expect(ecarts).toEqual([]);
  });

  it("les primes hebdomadaires et les frais d'affectation concordent exactement", () => {
    if (classeurs.size === 0) return;
    const ecarts: string[] = [];

    for (const [nom, ws] of classeurs) {
      const emp = rapport!.employees.find((e) => e.name === nom);
      if (!emp) continue;
      const val = (cle: string) => emp.lines.find((l) => l.rubrique === cle)?.value ?? 0;

      // Forfaits hebdomadaires : les quatre semaines sont rattachées à
      // juillet, donc aucun écart n'est admis ici.
      const paires: Array<[string, number, string]> = [
        ["logement", 18, "R"],
        ["primeManagement", 19, "S"],
        ["primeHabillage", 20, "T"],
        ["primePoste", 21, "U"],
        ["primeMasque", 22, "V"],
        ["primeZone", 25, "Y"],
        ["fraisSncf", 12, "L"],
        ["retenueChambre", 23, "W"],
      ];
      for (const [rubrique, col, lettre] of paires) {
        const excel = sommeColonne(ws, col);
        if (excel !== val(rubrique)) {
          ecarts.push(`${nom} : colonne ${lettre} = ${excel}, Silae ${rubrique} = ${val(rubrique)}`);
        }
      }
    }

    expect(ecarts).toEqual([]);
  });

  it("les repas : l'Excel porte un montant, Silae un nombre — le rapprochement tient", () => {
    if (classeurs.size === 0) return;
    const ecarts: string[] = [];

    for (const [nom, ws] of classeurs) {
      const emp = rapport!.employees.find((e) => e.name === nom);
      if (!emp) continue;
      const val = (cle: string) => emp.lines.find((l) => l.rubrique === cle)?.value ?? 0;
      const att = attendus.get(nom)!;

      // Repas midi : 20 € par jour travaillé dans le classeur, un nombre de
      // repas côté Silae. L'écart doit valoir les jours d'août.
      const midiExcel = sommeColonne(ws, 13);
      const midiSilae = val("repasMidi");
      if (midiExcel > 0 || midiSilae > 0) {
        const joursExcel = Math.round((midiExcel / 20) * 100) / 100;
        const ecart = Math.round((joursExcel - midiSilae) * 100) / 100;
        if (ecart !== att.joursTravaillesAout) {
          ecarts.push(`${nom} : repas midi Excel ${midiExcel} € (${joursExcel} j) − Silae ${midiSilae} = ${ecart}, attendu ${att.joursTravaillesAout}`);
        }
      }
    }

    expect(ecarts).toEqual([]);
  });

  it("aucun salarié porteur d'heures ne passe sans matricule", () => {
    if (classeurs.size === 0) return;
    // La règle, et non un accident du jeu de données : tout salarié porteur
    // d'au moins une rubrique DOIT avoir un matricule, sans quoi il figure
    // dans les points bloquants. Écrit ainsi, le test reste juste que le
    // matricule du salarié 40 soit renseigné ou non.
    const sansMatricule = rapport!.employees.filter((e) => e.lines.length > 0 && !e.matricule);
    expect(rapport!.blocking).toHaveLength(sansMatricule.length);
    for (const e of sansMatricule) {
      expect(rapport!.blocking.join(" ")).toContain(e.name);
    }
  });
});
