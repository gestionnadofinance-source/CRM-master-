/**
 * Doublons SIRET sous concurrence (BUG-001).
 *
 * Avant correctif, createClient/createProspect lisaient puis écrivaient en
 * deux requêtes séparées, en READ COMMITTED : deux créations simultanées
 * portant le même SIRET ne voyaient ni l'une ni l'autre de doublon et
 * inséraient toutes les deux. Le contrôle et la création tiennent
 * désormais dans une transaction sérialisable (src/server/transactions.ts).
 *
 * Ce test rejoue la course pour de vrai — N appels concurrents sur le même
 * SIRET contre le Postgres local — et vérifie qu'il n'en reste qu'un seul
 * en base, sans perdre le doublon volontaire (confirmDuplicate).
 *
 * Intégration contre le vrai Postgres local, comme tests/vault.test.ts —
 * fixtures namespacées "__TEST__" créées ici et nettoyées dans afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessCategory, CrmRole } from "@/server/permissions";
import type { AuthContext, SessionUser } from "@/server/auth/session";
import { createClient } from "@/server/clients/actions";
import { createProspect } from "@/server/prospects/actions";

// Voir tests/vault.test.ts : revalidatePath exige un contexte de requête
// Next.js qui n'existe pas dans un process Vitest, et n'a aucun effet utile ici.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SLUG = "__test__-race-crm";
const EMAIL = "__test__.race.owner@test.local";
const SIRET = "12345678901234";
const CONCURRENCY = 10;

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
  if (crm) await prisma.crm.delete({ where: { id: crm.id } }); // cascade Client/Prospect/UserCrmAccess
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

describe("doublons SIRET sous concurrence", () => {
  let crm: Crm;
  let owner: User;

  beforeAll(async () => {
    await wipeFixtures();
    crm = await prisma.crm.create({ data: { name: "__TEST__ Race CRM", slug: SLUG } });
    owner = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Race", email: EMAIL, passwordHash: "x", color: "#444444" },
    });
    await prisma.userCrmAccess.create({
      data: { userId: owner.id, crmId: crm.id, role: CrmRole.MANAGER, category: AccessCategory.COMMERCIAL },
    });
  });

  afterAll(wipeFixtures);

  function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it(`ne crée qu'un seul client pour ${CONCURRENCY} créations simultanées sur le même SIRET`, async () => {
    const ctx = toCtx(owner);
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        createClient(crm.id, form({ company: `__TEST__ Concurrent ${i}`, siret: SIRET, ownerId: owner.id }), ctx)
      )
    );

    const created = results.filter((r) => r.ok);
    const duplicates = results.filter((r) => !r.ok && r.duplicate);

    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(CONCURRENCY - 1);

    const inDb = await prisma.client.findMany({ where: { crmId: crm.id, siret: SIRET } });
    expect(inDb).toHaveLength(1);
  });

  it("laisse passer le doublon quand l'utilisateur l'a confirmé", async () => {
    const res = await createClient(
      crm.id,
      form({ company: "__TEST__ Doublon assumé", siret: SIRET, ownerId: owner.id, confirmDuplicate: "true" }),
      toCtx(owner)
    );

    expect(res.ok).toBe(true);
    const inDb = await prisma.client.findMany({ where: { crmId: crm.id, siret: SIRET } });
    expect(inDb).toHaveLength(2);
  });

  it(`ne crée qu'un seul prospect pour ${CONCURRENCY} créations simultanées sur le même SIRET`, async () => {
    const ctx = toCtx(owner);
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        createProspect(crm.id, form({ company: `__TEST__ Prospect ${i}`, siret: SIRET, ownerId: owner.id }), ctx)
      )
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.duplicate)).toHaveLength(CONCURRENCY - 1);

    const inDb = await prisma.prospect.findMany({ where: { crmId: crm.id, siret: SIRET } });
    expect(inDb).toHaveLength(1);
  });
});
