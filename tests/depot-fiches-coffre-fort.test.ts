/**
 * Dépôt des fiches de pointage dans le coffre-fort de chaque salarié
 * (bouton « Déposer au coffre-fort » de l'écran du chef de chantier).
 *
 * Signalé en production : l'écran entier était remplacé par « This page
 * couldn't load — A server error occurred ». Une action serveur qui LÈVE une
 * exception produit exactement cet écran. Ce test fixe le contrat corrigé :
 *   - l'action ne lève jamais, quelle que soit la panne : elle renvoie un
 *     message ;
 *   - un service temps réel indisponible ne fait pas déclarer en échec (et
 *     donc redéposer en double) une fiche bien déposée ;
 *   - toutes les fiches d'un chantier de taille réelle sont déposées.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import type { AuthContext } from "@/server/auth/session";

const etat = vi.hoisted(() => ({ ctx: null as unknown as AuthContext }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
// La session vient normalement des en-têtes de la requête, absents ici.
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requireAuth: async () => etat.ctx,
}));
// Service temps réel en panne : la notification échoue à chaque fois.
vi.mock("@/lib/realtime", () => ({
  publishToUser: async () => {
    throw new Error("Pusher indisponible");
  },
}));

const { depositEmployeeTimesheets } = await import("@/server/pointage/actions");
const { getStorageDriver } = await import("@/lib/storage");

const SLUG = "__test__depot_fiches";
const NB = 12; // au-delà d'un lot : vérifie l'enchaînement des lots
const LUNDI = "2026-07-06";
let crmId = "";
let chantierId = "";
let adminCtx: AuthContext;

function contexte(u: { id: string; firstName: string; lastName: string; email: string; isGlobalAdmin: boolean }): AuthContext {
  return {
    sessionId: "x",
    user: { ...u, status: "ACTIVE", color: null, avatarUrl: null, theme: "SYSTEM", mustChangePassword: false },
  } as unknown as AuthContext;
}

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");
  const admin = await prisma.user.create({
    data: { email: "__test__df_admin@example.invalid", firstName: "Test", lastName: "Admin", passwordHash, isGlobalAdmin: true, mustChangePassword: false },
  });
  adminCtx = contexte(admin);
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test dépôt" } });
  crmId = crm.id;
  const chantier = await prisma.chantier.create({
    data: {
      crmId, name: "Chantier dépôt", createdById: admin.id,
      startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-31T00:00:00Z"),
      lunchAllowance: 20, maskBonus: 3,
    },
  });
  chantierId = chantier.id;
  for (let i = 0; i < NB; i++) {
    const u = await prisma.user.create({
      data: { email: `__test__df_emp${i}@example.invalid`, firstName: "S", lastName: `EMP${i}`, passwordHash, mustChangePassword: false },
    });
    await prisma.userCrmAccess.create({ data: { userId: u.id, crmId, category: "OUVRIER" } });
    await prisma.chantierAssignment.create({ data: { chantierId, userId: u.id, kmRate: 0.5, distanceKm: 10 } });
    const days = Array.from({ length: 7 }, (_, j) => {
      const d = new Date(`${LUNDI}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + j);
      return { date: d.toISOString().slice(0, 10), normal: j < 5 ? 7 : 0, matin: 0, apresMidi: 0, nuit: 0 };
    });
    await prisma.pointage.create({
      data: {
        crmId, chantierId, employeeId: u.id, foremanId: admin.id,
        weekStart: new Date(`${LUNDI}T00:00:00Z`), days,
        hourlyRate: 12, nightRatePercent: 25, lunchAllowanceApplied: true, maskBonusApplied: true,
      },
    });
  }
});

afterAll(async () => {
  if (crmId) {
    const docs = await prisma.vaultDocument.findMany({ where: { crmId }, select: { storageKey: true } });
    const driver = getStorageDriver();
    await Promise.all(docs.map((d) => driver.remove(d.storageKey).catch(() => undefined)));
    await prisma.crm.delete({ where: { id: crmId } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__df_" } } });
});

describe("dépôt des fiches salariés au coffre-fort", () => {
  it("dépose une fiche par salarié, même quand le temps réel est en panne", async () => {
    etat.ctx = adminCtx;
    const res = await depositEmployeeTimesheets(crmId, chantierId, `${LUNDI}T00:00:00.000Z`);
    expect(res).toEqual({ ok: true, failedEmployees: undefined });

    const docs = await prisma.vaultDocument.findMany({ where: { crmId, category: "TIMESHEET_EMPLOYEE" } });
    expect(docs).toHaveLength(NB);
    expect(new Set(docs.map((d) => d.userId)).size).toBe(NB);
    // La notification en base est bien écrite ; seul l'envoi temps réel a échoué.
    expect(await prisma.notification.count({ where: { crmId, type: "DOCUMENT_ADDED" } })).toBe(NB);
  });

  it("une panne inattendue rend un message, jamais une exception", async () => {
    etat.ctx = adminCtx;
    // Date illisible : la requête en base échoue hors de la boucle par salarié.
    const res = await depositEmployeeTimesheets(crmId, chantierId, "pas-une-date");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/interrompu/);
  });

  it("un refus d'accès rend un message, jamais une exception", async () => {
    const intrus = await prisma.user.create({
      data: { email: "__test__df_intrus@example.invalid", firstName: "I", lastName: "NTRUS", passwordHash: "x", mustChangePassword: false },
    });
    await prisma.userCrmAccess.create({ data: { userId: intrus.id, crmId, category: "OUVRIER" } });
    etat.ctx = contexte(intrus);
    const res = await depositEmployeeTimesheets(crmId, chantierId, `${LUNDI}T00:00:00.000Z`);
    expect(res).toEqual({ ok: false, error: "Vous n'êtes pas chef de chantier." });
  });
});
