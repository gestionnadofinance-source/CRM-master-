/**
 * Bornes de longueur des champs texte (BUG-003).
 *
 * Les schémas zod des server actions n'avaient pas de borne haute : un
 * appelant — notamment via l'API publique d'écriture, qui accepte du JSON
 * arbitraire — pouvait stocker des mégaoctets par requête. Les bornes
 * vivent dans src/lib/validation.ts et sont volontairement larges pour ne
 * rendre aucune fiche existante non modifiable.
 *
 * Intégration contre le vrai Postgres local, comme tests/vault.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessCategory, CrmRole } from "@/server/permissions";
import type { AuthContext, SessionUser } from "@/server/auth/session";
import { createClient } from "@/server/clients/actions";
import { MAX_LONG, MAX_SHORT } from "@/lib/validation";

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

describe("bornes de longueur des champs texte", () => {
  let crm: Crm;
  let owner: User;

  beforeAll(async () => {
    await wipeFixtures();
    crm = await prisma.crm.create({ data: { name: "__TEST__ Bounds CRM", slug: SLUG } });
    owner = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Bounds", email: EMAIL, passwordHash: "x", color: "#555555" },
    });
    await prisma.userCrmAccess.create({
      data: { userId: owner.id, crmId: crm.id, role: CrmRole.MANAGER, category: AccessCategory.COMMERCIAL },
    });
  });

  afterAll(wipeFixtures);

  function create(fields: Record<string, string>) {
    const fd = new FormData();
    fd.set("company", "__TEST__ Bornes");
    fd.set("ownerId", owner.id);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return createClient(crm.id, fd, toCtx(owner));
  }

  it("refuse un nom d'entreprise au-delà de la borne, avec un message en français", async () => {
    const res = await create({ company: "x".repeat(MAX_SHORT + 1) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`Ce champ ne peut pas dépasser ${MAX_SHORT} caractères.`);
  });

  it("refuse des notes au-delà de la borne", async () => {
    const res = await create({ notes: "x".repeat(MAX_LONG + 1) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`Ce champ ne peut pas dépasser ${MAX_LONG} caractères.`);
  });

  it("accepte une saisie réaliste, y compris des notes très longues", async () => {
    // ~19 000 caractères : bien au-delà de toute fiche réelle, mais sous la
    // borne — c'est la marge qui garantit qu'aucune donnée déjà enregistrée
    // ne devient non modifiable.
    const res = await create({ company: "x".repeat(MAX_SHORT), notes: "note. ".repeat(3_000) });
    expect(res.ok).toBe(true);
  });

  it("borne aussi la mise à jour, pas seulement la création", async () => {
    const created = await create({ company: "__TEST__ À modifier" });
    expect(created.ok).toBe(true);

    const { updateClient } = await import("@/server/clients/actions");
    const fd = new FormData();
    fd.set("company", "y".repeat(MAX_SHORT + 1));
    fd.set("ownerId", owner.id);
    const res = await updateClient(crm.id, created.clientId!, fd, toCtx(owner));
    expect(res.ok).toBe(false);
  });
});
