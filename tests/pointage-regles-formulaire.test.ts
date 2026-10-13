/**
 * Règles du formulaire de pointage côté serveur (octobre 2026) :
 *   - le chef de chantier ne voit pas le taux horaire de ses salariés et ne
 *     peut pas le fixer, même en forgeant la requête ;
 *   - l'administration le voit et le fixe ;
 *   - le nombre de repas midi / soir est choisi, mais jamais au-delà des
 *     jours travaillés ;
 *   - salissure cochée = une unité, enregistrée comme telle.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import type { AuthContext } from "@/server/auth/session";

const etat = vi.hoisted(() => ({ ctx: null as unknown as AuthContext }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  requireAuth: async () => etat.ctx,
}));

const { upsertPointageEntryCore } = await import("@/server/pointage/core");
const { listChantierRosterForWeek } = await import("@/server/pointage/actions");

const SLUG = "__test__regles_form";
const LUNDI = "2026-07-06";
let crmId = "";
let chantierId = "";
let salarieId = "";
let adminCtx: AuthContext;
let chefCtx: AuthContext;

function contexte(u: { id: string; firstName: string; lastName: string; email: string; isGlobalAdmin: boolean }): AuthContext {
  return {
    sessionId: "x",
    user: { ...u, status: "ACTIVE", color: null, avatarUrl: null, theme: "SYSTEM", mustChangePassword: false },
  } as unknown as AuthContext;
}

/** Semaine de 5 jours travaillés (lundi → vendredi). */
function cinqJours() {
  return Array.from({ length: 7 }, (_, j) => {
    const d = new Date(`${LUNDI}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + j);
    return { date: d.toISOString().slice(0, 10), normal: j < 5 ? 7 : 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
}

function fiche(champs: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("employeeId", salarieId);
  fd.set("weekStart", `${LUNDI}T00:00:00.000Z`);
  fd.set("days", JSON.stringify(cinqJours()));
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

const pointage = () =>
  prisma.pointage.findUniqueOrThrow({
    where: { chantierId_employeeId_weekStart: { chantierId, employeeId: salarieId, weekStart: new Date(`${LUNDI}T00:00:00Z`) } },
  });

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");
  const admin = await prisma.user.create({
    data: { email: "__test__rf_admin@example.invalid", firstName: "Test", lastName: "Admin", passwordHash, isGlobalAdmin: true, mustChangePassword: false },
  });
  const chef = await prisma.user.create({
    data: { email: "__test__rf_chef@example.invalid", firstName: "Test", lastName: "Chef", passwordHash, mustChangePassword: false },
  });
  const salarie = await prisma.user.create({
    data: { email: "__test__rf_sal@example.invalid", firstName: "Test", lastName: "Salarie", passwordHash, mustChangePassword: false },
  });
  salarieId = salarie.id;
  adminCtx = contexte(admin);
  chefCtx = contexte(chef);
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test règles" } });
  crmId = crm.id;
  await prisma.userCrmAccess.create({ data: { userId: chef.id, crmId, category: "OUVRIER", isForeman: true } });
  await prisma.userCrmAccess.create({ data: { userId: salarie.id, crmId, category: "OUVRIER", defaultHourlyRate: 14 } });
  const chantier = await prisma.chantier.create({
    data: {
      crmId, name: "Chantier règles", createdById: admin.id, lunchAllowance: 20, dinnerAllowance: 15,
      startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-07-31T00:00:00Z"),
    },
  });
  chantierId = chantier.id;
  await prisma.chantierAssignment.create({ data: { chantierId, userId: chef.id } });
  await prisma.chantierAssignment.create({ data: { chantierId, userId: salarie.id } });
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__rf_" } } });
});

describe("taux horaire : invisible et non modifiable par le chef de chantier", () => {
  it("une fiche créée par le chef prend le taux par défaut du salarié, quoi qu'il envoie", async () => {
    const res = await upsertPointageEntryCore(chefCtx, crmId, chantierId, fiche({ hourlyRate: "99", managementBonusApplied: "true" }));
    expect(res.ok).toBe(true);
    expect(Number((await pointage()).hourlyRate)).toBe(14);
  });

  it("l'administration fixe le taux ; le chef ne peut plus le changer ensuite", async () => {
    expect((await upsertPointageEntryCore(adminCtx, crmId, chantierId, fiche({ hourlyRate: "16" }))).ok).toBe(true);
    expect(Number((await pointage()).hourlyRate)).toBe(16);

    expect((await upsertPointageEntryCore(chefCtx, crmId, chantierId, fiche({ hourlyRate: "1" }))).ok).toBe(true);
    expect(Number((await pointage()).hourlyRate)).toBe(16);
  });

  it("la feuille du chef ne transporte ni le taux ni les montants qui le trahiraient", async () => {
    await upsertPointageEntryCore(adminCtx, crmId, chantierId, fiche({ hourlyRate: "16", managementBonusApplied: "true" }));

    etat.ctx = chefCtx;
    const vueChef = await listChantierRosterForWeek(crmId, chantierId, `${LUNDI}T00:00:00.000Z`);
    const ligneChef = vueChef.roster.find((r) => r.employeeId === salarieId)!;
    expect(ligneChef.canSeeRates).toBe(false);
    expect(ligneChef.rates.hourlyRate).toBeNull();
    expect(ligneChef.totals.managementTotal).toBe(0);
    expect(Object.values(ligneChef.rates)).not.toContain(16);

    etat.ctx = adminCtx;
    const vueAdmin = await listChantierRosterForWeek(crmId, chantierId, `${LUNDI}T00:00:00.000Z`);
    const ligneAdmin = vueAdmin.roster.find((r) => r.employeeId === salarieId)!;
    expect(ligneAdmin.rates.hourlyRate).toBe(16);
    expect(ligneAdmin.totals.managementTotal).toBe(40); // 50 % de 16 € × 5 jours
  });
});

describe("repas, salissure, habillage", () => {
  it("enregistre le nombre de repas choisi", async () => {
    const res = await upsertPointageEntryCore(
      chefCtx,
      crmId,
      chantierId,
      fiche({ lunchAllowanceApplied: "true", lunchCount: "3", dinnerAllowanceApplied: "true", dinnerCount: "1" })
    );
    expect(res.ok).toBe(true);
    const p = await pointage();
    expect(p.lunchCount).toBe(3);
    expect(p.dinnerCount).toBe(1);
  });

  it("refuse plus de repas que de jours travaillés", async () => {
    const res = await upsertPointageEntryCore(chefCtx, crmId, chantierId, fiche({ lunchAllowanceApplied: "true", lunchCount: "6" }));
    expect(res).toEqual({ ok: false, error: "Nombre de repas midi (6) supérieur au nombre de jours travaillés (5)." });
  });

  it("case décochée : aucun nombre de repas conservé", async () => {
    await upsertPointageEntryCore(chefCtx, crmId, chantierId, fiche({ lunchCount: "3" }));
    const p = await pointage();
    expect(p.lunchAllowanceApplied).toBe(false);
    expect(p.lunchCount).toBeNull();
  });

  it("salissure : une case, enregistrée comme telle", async () => {
    await upsertPointageEntryCore(chefCtx, crmId, chantierId, fiche({ dirtAllowanceApplied: "true", clothingBonusApplied: "true" }));
    const p = await pointage();
    expect(p.dirtAllowanceApplied).toBe(true);
    expect(p.clothingBonusApplied).toBe(true);
  });
});
