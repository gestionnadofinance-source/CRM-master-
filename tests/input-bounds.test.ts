/**
 * Bornes des champs de saisie (BUG-003, NEW-001, NEW-002).
 *
 * Trois règles partagées vivent dans src/lib/validation.ts et s'appliquent
 * à toutes les server actions :
 *   - une borne haute de longueur, pour qu'un appelant ne puisse pas
 *     stocker des mégaoctets par requête ;
 *   - le rejet des caractères de contrôle, que PostgreSQL refuse dans une
 *     colonne text (SQLSTATE 22021) et qui échouaient donc en base plutôt
 *     qu'à la validation ;
 *   - des bornes numériques calées sur la précision des colonnes Decimal.
 *
 * Vérifié ici de bout en bout sur createChantier — la création métier
 * centrale de l'ERP — contre le vrai Postgres local, comme
 * tests/vault.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessCategory, CrmRole } from "@/server/permissions";
import type { AuthContext, SessionUser } from "@/server/auth/session";
import { createChantier } from "@/server/planning/actions";
import { CONTROL_CHARS_MESSAGE } from "@/lib/validation";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SLUG = "__test__-bounds-crm";
const EMAIL = "__test__.bounds.owner@test.local";

function toCtx(user: User): AuthContext {
  const sessionUser: SessionUser = {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    isGlobalAdmin: user.isGlobalAdmin,
    status: user.status,
    color: user.color,
    avatarUrl: user.avatarUrl,
    theme: user.theme,
    mustChangePassword: user.mustChangePassword,
  };
  return { user: sessionUser, sessionId: "__test__-session" };
}

async function wipeFixtures(): Promise<void> {
  const crm = await prisma.crm.findUnique({ where: { slug: SLUG } });
  if (crm) await prisma.crm.delete({ where: { id: crm.id } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

describe("bornes des champs de saisie", () => {
  let crm: Crm;
  let owner: User;

  beforeAll(async () => {
    await wipeFixtures();
    crm = await prisma.crm.create({ data: { name: "__TEST__ Bounds CRM", slug: SLUG } });
    owner = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Bounds", email: EMAIL, passwordHash: "x", color: "#555555" },
    });
    await prisma.userCrmAccess.create({
      data: { userId: owner.id, crmId: crm.id, role: CrmRole.MANAGER, category: AccessCategory.SECRETAIRE },
    });
  });

  afterAll(wipeFixtures);

  function create(fields: Record<string, string>) {
    const fd = new FormData();
    fd.set("name", "__TEST__ Chantier");
    fd.set("startDate", "2026-09-01");
    fd.set("endDate", "2026-10-31");
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return createChantier(crm.id, fd, toCtx(owner));
  }

  it("accepte une saisie normale", async () => {
    const res = await create({ name: "__TEST__ Chantier Nord", address: "1 rue de la Paix" });
    expect(res.ok).toBe(true);
  });

  // --- Longueur -----------------------------------------------------------
  it("refuse un nom de chantier au-delà de la borne", async () => {
    const res = await create({ name: "x".repeat(201) });
    expect(res.ok).toBe(false);
  });

  it("refuse une description au-delà de la borne", async () => {
    const res = await create({ description: "x".repeat(2001) });
    expect(res.ok).toBe(false);
  });

  it("accepte une description longue mais sous la borne", async () => {
    const res = await create({ name: "__TEST__ Description longue", description: "détail. ".repeat(200) });
    expect(res.ok).toBe(true);
  });

  // --- Caractères de contrôle (NEW-001) -----------------------------------
  it("refuse un octet nul, au lieu de le laisser échouer en base", async () => {
    const res = await create({ name: "__TEST__ Chantier\u0000injecté" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(CONTROL_CHARS_MESSAGE);
  });

  it("refuse aussi les autres caractères de contrôle", async () => {
    for (const ch of ["\u0001", "\u0007", "\u001F"]) {
      const res = await create({ name: `__TEST__ Chantier${ch}x` });
      expect(res.ok, JSON.stringify(ch)).toBe(false);
    }
  });

  it("laisse passer sauts de ligne et tabulations dans un champ multiligne", async () => {
    const res = await create({
      name: "__TEST__ Chantier multiligne",
      importantDocuments: "document 1\nsuite\r\n\tindenté",
    });
    expect(res.ok).toBe(true);
  });

  // --- Bornes numériques (NEW-002) ----------------------------------------
  it("refuse une prime au-delà de la capacité de la colonne", async () => {
    const res = await create({ name: "__TEST__ Prime hors bornes", lunchAllowance: "1000000" });
    expect(res.ok).toBe(false);
  });

  it("accepte une prime dans les bornes", async () => {
    const res = await create({ name: "__TEST__ Prime normale", lunchAllowance: "12.50" });
    expect(res.ok).toBe(true);
  });
});
