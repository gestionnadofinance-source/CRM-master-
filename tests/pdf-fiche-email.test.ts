/**
 * Fiches envoyées par email au chef de chantier : aucun montant dérivé du
 * taux horaire (majoration de nuit, prime de management) ne doit y figurer,
 * sans quoi le chef retrouve le taux d'une simple division. Le PDF déposé au
 * coffre-fort du salarié, lui, garde tous ses montants.
 *
 * On lit le texte du PDF réellement joint à l'email, pas un rendu à part.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inflateSync } from "zlib";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import type { AuthContext } from "@/server/auth/session";

const etat = vi.hoisted(() => ({
  ctx: null as unknown as AuthContext,
  pieces: [] as Array<{ filename: string; content: Buffer }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requireAuth: async () => etat.ctx,
}));
vi.mock("@/lib/email", () => ({
  baseEmailLayout: (_t: string, body: string) => body,
  sendEmail: async (input: { attachments?: Array<{ filename: string; content: Buffer }> }) => {
    etat.pieces.push(...(input.attachments ?? []));
    return { delivered: true };
  },
}));

const { emailEmployeeTimesheets } = await import("@/server/pointage/actions");
const { renderEmployeeTimesheetPdf } = await import("@/server/pointage/pdf");

/** Texte d'un PDF react-pdf : flux décompressés, chaînes hexadécimales des opérateurs TJ/Tj. */
function texteDuPdf(pdf: Buffer): string {
  const brut = pdf.toString("latin1");
  const lignes: string[] = [];
  for (const m of brut.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let flux: string;
    try {
      flux = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const op of flux.matchAll(/(\[[^\]]*\]\s*TJ|<[0-9a-fA-F]*>\s*Tj)/g)) {
      const hex = Array.from(op[1]!.matchAll(/<([0-9a-fA-F]*)>/g), (h) => h[1]).join("");
      lignes.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return lignes.join("\n");
}

const SLUG = "__test__pdf_email";
const LUNDI = "2026-07-06";
let crmId = "";
let chantierId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");
  const chef = await prisma.user.create({
    data: { email: "__test__pe_chef@example.invalid", firstName: "Test", lastName: "Chef", passwordHash, mustChangePassword: false },
  });
  const salarie = await prisma.user.create({
    data: { email: "__test__pe_sal@example.invalid", firstName: "Test", lastName: "Salarie", passwordHash, mustChangePassword: false },
  });
  etat.ctx = {
    sessionId: "x",
    user: { id: chef.id, firstName: chef.firstName, lastName: chef.lastName, email: chef.email, isGlobalAdmin: false, status: "ACTIVE", color: chef.color, avatarUrl: null, theme: chef.theme, mustChangePassword: false },
  } as unknown as AuthContext;
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test PDF email" } });
  crmId = crm.id;
  await prisma.userCrmAccess.create({ data: { userId: chef.id, crmId, category: "OUVRIER", isForeman: true } });
  await prisma.userCrmAccess.create({ data: { userId: salarie.id, crmId, category: "OUVRIER" } });
  const chantier = await prisma.chantier.create({
    data: {
      crmId, name: "Chantier PDF", createdById: chef.id,
      startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-31T00:00:00Z"),
    },
  });
  chantierId = chantier.id;
  await prisma.chantierAssignment.create({ data: { chantierId, userId: chef.id } });
  await prisma.chantierAssignment.create({ data: { chantierId, userId: salarie.id } });
  // Taux 16 € : nuit 2 h × 16 × 50 % = 16,00 € ; management 50 % × 16 = 8,00 €.
  await prisma.pointage.create({
    data: {
      crmId, chantierId, employeeId: salarie.id, foremanId: chef.id,
      weekStart: new Date(`${LUNDI}T00:00:00Z`),
      days: [{ date: LUNDI, normal: 7, matin: 0, apresMidi: 0, nuit: 2 }],
      hourlyRate: 16, nightRatePercent: 50, managementBonusApplied: true,
    },
  });
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__pe_" } } });
});

describe("fiche de pointage envoyée par email au chef de chantier", () => {
  it("ne contient aucun montant dérivé du taux horaire", async () => {
    const res = await emailEmployeeTimesheets(crmId, chantierId, `${LUNDI}T00:00:00.000Z`);
    expect(res.ok).toBe(true);
    expect(etat.pieces).toHaveLength(1);

    const texte = texteDuPdf(etat.pieces[0]!.content);
    expect(texte).toContain("Heures de nuit");
    expect(texte).toContain("Prime management");
    expect(texte).toContain("calculée à la paie");
    for (const montant of ["16,00", "8,00", "24,00"]) expect(texte).not.toContain(montant);
  });

  it("le PDF du salarié (coffre-fort) garde ses montants", async () => {
    const p = await prisma.pointage.findFirstOrThrow({ where: { crmId } });
    const pdf = await renderEmployeeTimesheetPdf({
      crmName: "X", chantierName: "C", chantierAddress: null, employeeName: "E", foremanName: "F",
      weekStart: p.weekStart, weekEnd: p.weekStart, weekNumber: 28,
      days: [{ date: LUNDI, normal: 7, matin: 0, apresMidi: 0, nuit: 2 }],
      rates: { hourlyRate: 16, nightRatePercent: 50 },
      primes: { housingAllowance: 0, dirtAllowanceApplied: false, lunchCount: null, dinnerCount: null },
      chantierAmounts: { lunchAllowance: 0, dinnerAllowance: 0, travelAllowance: 0, maskBonus: 0, zoneBonus: 0, postBonus: 0, mealAllowance: 0 },
      assignmentRates: { kmRate: 0, distanceKm: 0, travelHourlyRate: 0, travelDurationHours: 0 },
      applied: {
        lunchAllowanceApplied: false, dinnerAllowanceApplied: false, travelAllowanceApplied: false, maskBonusApplied: false,
        managementBonusApplied: true, zoneBonusApplied: false, postBonusApplied: false, kmReimbursementApplied: false,
        travelHoursReimbursementApplied: false, mealAllowanceApplied: false, clothingBonusApplied: false,
      },
      comments: null,
    });
    const texte = texteDuPdf(pdf);
    for (const montant of ["16,00", "8,00", "24,00"]) expect(texte).toContain(montant);
    expect(texte).not.toContain("calculée à la paie");
  });
});
