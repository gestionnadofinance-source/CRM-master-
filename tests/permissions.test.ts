/**
 * Permission model: role defaults (src/server/permissions.ts) and the
 * requireCrmAccess(ctx, crmId, permission) gate (src/server/tenant.ts) that
 * enforces them.
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

describe("effectivePermissions / hasPermission (role defaults + overrides)", () => {
  it("USER has VIEW/CREATE/EDIT/MANAGE_* by default", () => {
    const access = { role: CrmRole.USER, category: AccessCategory.COMMERCIAL, permissions: [] as Permission[] };
    for (const p of [
      Permission.VIEW,
      Permission.CREATE,
      Permission.EDIT,
      Permission.MANAGE_APPOINTMENTS,
      Permission.MANAGE_QUOTES,
      Permission.MANAGE_PROSPECTS,
      Permission.MANAGE_CLIENTS,
    ]) {
      expect(hasPermission(access, p)).toBe(true);
    }
  });

  it("USER does NOT have DELETE/EXPORT/MANAGE_SETTINGS/MANAGE_USERS by default", () => {
    const access = { role: CrmRole.USER, category: AccessCategory.COMMERCIAL, permissions: [] as Permission[] };
    for (const p of [Permission.DELETE, Permission.EXPORT, Permission.MANAGE_SETTINGS, Permission.MANAGE_USERS]) {
      expect(hasPermission(access, p)).toBe(false);
    }
  });

  it("MANAGER has every permission by default", () => {
    const access = { role: CrmRole.MANAGER, category: AccessCategory.COMMERCIAL, permissions: [] as Permission[] };
    for (const p of Object.values(Permission)) {
      expect(hasPermission(access, p)).toBe(true);
    }
  });

  it("an explicit additive override grants the extra permission without removing role defaults or leaking to unrelated ones", () => {
    const access = { role: CrmRole.USER, category: AccessCategory.COMMERCIAL, permissions: [Permission.EXPORT] };
    const effective = effectivePermissions(access);

    expect(effective.has(Permission.EXPORT)).toBe(true); // granted via override
    expect(effective.has(Permission.VIEW)).toBe(true); // still has role defaults
    expect(effective.has(Permission.DELETE)).toBe(false); // override doesn't leak to other permissions
    expect(effective.has(Permission.MANAGE_SETTINGS)).toBe(false);
  });

  it("OUVRIER category has NO commercial permission by default, even as MANAGER role", () => {
    const access = { role: CrmRole.MANAGER, category: AccessCategory.OUVRIER, permissions: [] as Permission[] };
    for (const p of Object.values(Permission)) {
      expect(hasPermission(access, p)).toBe(false);
    }
  });

  it("OUVRIER category still honors an explicit additive override", () => {
    const access = { role: CrmRole.USER, category: AccessCategory.OUVRIER, permissions: [Permission.VIEW] };
    const effective = effectivePermissions(access);
    expect(effective.has(Permission.VIEW)).toBe(true);
    expect(effective.has(Permission.MANAGE_CLIENTS)).toBe(false);
  });

  it("SECRETAIRE category has NO commercial permission by default, even as MANAGER role (same defense-in-depth as OUVRIER)", () => {
    const access = { role: CrmRole.MANAGER, category: AccessCategory.SECRETAIRE, permissions: [] as Permission[] };
    for (const p of Object.values(Permission)) {
      expect(hasPermission(access, p)).toBe(false);
    }
  });

  it("SECRETAIRE category still honors an explicit additive override", () => {
    const access = { role: CrmRole.USER, category: AccessCategory.SECRETAIRE, permissions: [Permission.VIEW] };
    const effective = effectivePermissions(access);
    expect(effective.has(Permission.VIEW)).toBe(true);
    expect(effective.has(Permission.MANAGE_CLIENTS)).toBe(false);
  });
});

describe("canManageOperations (SECRETAIRE bypass for Planning/Coffre-fort/Ordre de mission)", () => {
  function tenant(overrides: Partial<TenantContext>): TenantContext {
    return {
      crmId: "crm1",
      crmSlug: "crm1",
      crmName: "CRM 1",
      role: CrmRole.USER,
      category: AccessCategory.COMMERCIAL,
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

  it("denies access for a plain COMMERCIAL USER without MANAGE_SETTINGS", () => {
    expect(canManageOperations(tenant({ category: AccessCategory.COMMERCIAL }))).toBe(false);
  });

  it("grants access via the MANAGE_SETTINGS permission itself (COMMERCIAL MANAGER)", () => {
    expect(
      canManageOperations(
        tenant({ category: AccessCategory.COMMERCIAL, permissions: new Set([Permission.MANAGE_SETTINGS]) })
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

  it("succeeds when checking a permission the USER role does have (VIEW)", async () => {
    await expect(requireCrmAccess(toCtx(user), crm.id, Permission.VIEW)).resolves.toMatchObject({ crmId: crm.id });
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
