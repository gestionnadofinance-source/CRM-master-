/**
 * Gardes d'accès destinées au rendu d'une page (src/server/tenant.ts).
 *
 * Next.js peut rendre layout.tsx et page.tsx en parallèle : le
 * `catch (AuthError) → notFound()` du layout /c/[crmSlug] ne protège donc pas
 * une AuthError levée par la page elle-même, qui remontait en HTTP 500.
 * Constaté à l'audit sur /c/[crmSlug]/settings (permission insuffisante) et
 * sur /c/[crmSlug]/clients/[id] pointant un client d'un autre CRM.
 *
 * Un 500 n'est pas seulement inélégant : il distingue une ressource qui existe
 * ailleurs d'un identifiant inventé, alors qu'un 404 est indistinguable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthContext, type SessionUser } from "@/server/auth/session";
import {
  requireCrmAccess,
  requireCrmAccessBySlug,
  requireCrmAccessBySlugOrNotFound,
  assertBelongsToCrm,
  assertBelongsToCrmOrNotFound,
} from "@/server/tenant";
import { CrmRole, AccessCategory, Permission } from "@/server/permissions";

const SLUG_A = "__test__guards-a";
const SLUG_B = "__test__guards-b";
const EMAIL = "__test__guards@x.local";

let crmA: Crm, crmB: Crm, user: User, ctx: AuthContext;

/** notFound() lève une erreur interne de Next.js portant ce digest. */
function isNextNotFound(err: unknown): boolean {
  return typeof (err as { digest?: unknown })?.digest === "string" &&
    (err as { digest: string }).digest.includes("404");
}

async function wipe() {
  await prisma.userCrmAccess.deleteMany({ where: { crm: { slug: { in: [SLUG_A, SLUG_B] } } } });
  await prisma.crm.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await wipe();
  crmA = await prisma.crm.create({ data: { name: "__TEST__ Guards A", slug: SLUG_A } });
  crmB = await prisma.crm.create({ data: { name: "__TEST__ Guards B", slug: SLUG_B } });
  user = await prisma.user.create({
    data: { firstName: "__TEST__", lastName: "Guards", email: EMAIL, passwordHash: "x", color: "#111111" },
  });
  // Simple utilisateur de l'espace A : aucune permission MANAGE_SETTINGS, aucun accès à l'espace B.
  await prisma.userCrmAccess.create({
    data: { userId: user.id, crmId: crmA.id, role: CrmRole.USER, category: AccessCategory.SECRETAIRE },
  });
  ctx = { sessionId: "s", user: user as unknown as SessionUser };
});

afterAll(wipe);

describe("requireCrmAccessBySlugOrNotFound", () => {
  it("laisse passer un accès légitime, comme la garde brute", async () => {
    const tenant = await requireCrmAccessBySlugOrNotFound(ctx, SLUG_A);
    expect(tenant.crmId).toBe(crmA.id);
  });

  it("traduit une permission insuffisante en 404, jamais en erreur serveur", async () => {
    // Le cas de /c/[crmSlug]/settings pour un simple utilisateur.
    await expect(requireCrmAccessBySlug(ctx, SLUG_A, Permission.MANAGE_SETTINGS)).rejects.toBeInstanceOf(AuthError);
    const err = await requireCrmAccessBySlugOrNotFound(ctx, SLUG_A, Permission.MANAGE_SETTINGS).catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthError);
    expect(isNextNotFound(err)).toBe(true);
  });

  it("traduit un CRM auquel l'utilisateur n'a pas accès en 404", async () => {
    const err = await requireCrmAccessBySlugOrNotFound(ctx, SLUG_B).catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthError);
    expect(isNextNotFound(err)).toBe(true);
  });

  it("traduit un CRM inexistant en 404", async () => {
    const err = await requireCrmAccessBySlugOrNotFound(ctx, "__test__aucun-crm").catch((e) => e);
    expect(isNextNotFound(err)).toBe(true);
  });
});

describe("assertBelongsToCrmOrNotFound", () => {
  it("ne lève rien quand l'entité appartient bien au CRM courant", async () => {
    const tenant = await requireCrmAccess(ctx, crmA.id);
    expect(() => assertBelongsToCrmOrNotFound(crmA.id, tenant, "Client")).not.toThrow();
  });

  it("traduit une entité d'un autre CRM en 404, jamais en erreur serveur", async () => {
    // Le cas de /c/{A}/clients/{id d'un client du CRM B}.
    const tenant = await requireCrmAccess(ctx, crmA.id);
    expect(() => assertBelongsToCrm(crmB.id, tenant, "Client")).toThrow(AuthError);
    let err: unknown;
    try { assertBelongsToCrmOrNotFound(crmB.id, tenant, "Client"); } catch (e) { err = e; }
    expect(err).not.toBeInstanceOf(AuthError);
    expect(isNextNotFound(err)).toBe(true);
  });
});
