/**
 * Permission model: role defaults (src/server/permissions.ts) and the
 * requireCrmAccess(ctx, crmId, permission) gate (src/server/tenant.ts) that
 * enforces them.
 *
 * Note : depuis le retrait du commercial, seule la catégorie COMMERCIAL —
 * encore présente dans l'énumération Prisma, plus proposée nulle part —
 * hérite des droits par défaut de son rôle ; OUVRIER et SECRETAIRE
 * n'héritent de rien et passent par des contrôles de catégorie dédiés.
 * C'est ce qui est vérifié ici.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthContext, type SessionUser } from "@/server/auth/session";
import { requireCrmAccess, canManageOperations, type TenantContext } from "@/server/tenant";
import { CrmRole, AccessCategory, Permission, effectivePermissions, hasPermission } from "@/server/permissions";

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

describe("effectivePermissions / hasPermission", () => {
  // Depuis le retrait du volet commercial, aucune des deux catégories
  // restantes n'hérite de permission par défaut : seules les dérogations
  // explicites posées sur UserCrmAccess.permissions en accordent. C'est ce
  // que ces tests fixent — y compris le fait qu'un rôle MANAGER n'ouvre
  // rien à lui seul.
  for (const category of [AccessCategory.OUVRIER, AccessCategory.SECRETAIRE]) {
    it(`la catégorie ${category} n'a AUCUNE permission par défaut, même en rôle MANAGER`, () => {
      const access = { role: CrmRole.MANAGER, category, permissions: [] as Permission[] };
      for (const p of Object.values(Permission)) {
        expect(hasPermission(access, p)).toBe(false);
      }
    });

    it(`la catégorie ${category} honore une dérogation explicite, sans fuite vers les autres permissions`, () => {
      const access = { role: CrmRole.USER, category, permissions: [Permission.EXPORT] };
      const effective = effectivePermissions(access);

      expect(effective.has(Permission.EXPORT)).toBe(true);
      expect(effective.has(Permission.VIEW)).toBe(false);
      expect(effective.has(Permission.MANAGE_SETTINGS)).toBe(false);
      expect(effective.has(Permission.MANAGE_USERS)).toBe(false);
    });
  }

  it("le rôle n'accorde rien par lui-même : MANAGER et USER donnent le même résultat", () => {
    const base = { category: AccessCategory.SECRETAIRE, permissions: [Permission.VIEW] };
    const asManager = effectivePermissions({ ...base, role: CrmRole.MANAGER });
    const asUser = effectivePermissions({ ...base, role: CrmRole.USER });

    expect([...asManager].sort()).toEqual([...asUser].sort());
  });
});

describe("canManageOperations (SECRETAIRE bypass for Planning/Coffre-fort/Ordre de mission)", () => {
  function tenant(overrides: Partial<TenantContext>): TenantContext {
    return {
      crmId: "crm1",
      crmSlug: "crm1",
      crmName: "CRM 1",
      role: CrmRole.USER,
      category: AccessCategory.OUVRIER,
      permissions: new Set<Permission>(),
      isGlobalAdmin: false,
      ...overrides,
    };
  }

  it("grants access for SECRETAIRE even without MANAGE_SETTINGS", () => {
    expect(canManageOperations(tenant({ category: AccessCategory.SECRETAIRE }))).toBe(true);
  });

  it("denies access for OUVRIER (no permission, no category bypass)", () => {
    expect(canManageOperations(tenant({ category: AccessCategory.OUVRIER }))).toBe(false);
  });

  it("grants access via the MANAGE_SETTINGS permission itself", () => {
    expect(
      canManageOperations(
        tenant({ category: AccessCategory.OUVRIER, permissions: new Set([Permission.MANAGE_SETTINGS]) })
      )
    ).toBe(true);
  });

  it("grants access for a global admin regardless of category", () => {
    expect(canManageOperations(tenant({ category: AccessCategory.OUVRIER, isGlobalAdmin: true }))).toBe(true);
  });
});

describe("requireCrmAccess permission gating", () => {
  const SLUG = "__test__-permissions-crm";
  const EMAIL = "__test__.permissions.user@test.local";

  let crm: Crm;
  let user: User;

  beforeAll(async () => {
    await wipe();
    crm = await prisma.crm.create({ data: { name: "__TEST__ Permissions CRM", slug: SLUG } });
    user = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "PermUser", email: EMAIL, passwordHash: "x", color: "#444444" },
    });
    // USER role, no permission override: has CRM access but lacks DELETE.
    await prisma.userCrmAccess.create({ data: { userId: user.id, crmId: crm.id, role: CrmRole.USER } });
  });

  afterAll(async () => {
    await wipe();
  });

  async function wipe() {
    const existing = await prisma.crm.findUnique({ where: { slug: SLUG } });
    if (existing) await prisma.crm.delete({ where: { id: existing.id } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  }

  it("succeeds with no permission argument (CRM access alone is enough)", async () => {
    await expect(requireCrmAccess(toCtx(user), crm.id)).resolves.toMatchObject({ crmId: crm.id });
  });

  it("refuse une permission non accordée explicitement, le rôle n'en donnant plus aucune (VIEW)", async () => {
    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.VIEW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN (not CRM_ACCESS_DENIED) when the user has CRM access but lacks the specific permission (DELETE)", async () => {
    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.DELETE)).rejects.toBeInstanceOf(AuthError);
    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.DELETE)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("an additive override on UserCrmAccess.permissions lets requireCrmAccess grant that specific permission", async () => {
    await prisma.userCrmAccess.update({
      where: { userId_crmId: { userId: user.id, crmId: crm.id } },
      data: { permissions: [Permission.EXPORT] },
    });

    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.EXPORT)).resolves.toMatchObject({ crmId: crm.id });
    // still lacks DELETE even after the EXPORT override
    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.DELETE)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
