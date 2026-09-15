/**
 * Auth primitives: password hashing and the DB-backed session validity
 * invariant enforced by getAuthContext() (src/server/auth/session.ts).
 *
 * Identifiers/passwords are entirely admin-managed (no 2FA, no
 * self-service reset — see src/server/admin/actions.ts), so the only
 * per-session state left to verify is session validity itself.
 *
 * getAuthContext() itself reads next/headers cookies, which only exist
 * inside a real request — it is not called directly here. Instead the DB
 * rows it depends on are built the same way it builds them, and its exact
 * validity conditions (session not found / revoked / expired / user
 * disabled) are asserted against a real fetched session+user join.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateToken, hashPassword, hashToken, verifyPassword } from "@/lib/crypto";

describe("password hashing (hashPassword / verifyPassword)", () => {
  it("round-trips correctly and rejects a wrong password", async () => {
    const hash = await hashPassword("__TEST__Sup3rSecret!");
    expect(hash).not.toBe("__TEST__Sup3rSecret!");
    expect(await verifyPassword("__TEST__Sup3rSecret!", hash)).toBe(true);
    expect(await verifyPassword("__TEST__WrongPassword!", hash)).toBe(false);
  });
});

describe("session validity invariants (mirrors getAuthContext's exact checks)", () => {
  const EMAIL = "__test__.auth.session@test.local";
  let disabledUser: User;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    disabledUser = await prisma.user.create({
      data: {
        firstName: "__TEST__",
        lastName: "Disabled",
        email: EMAIL,
        passwordHash: await hashPassword("__TEST__Whatever1"),
        status: "DISABLED",
        color: "#555555",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  /** Same predicate as getAuthContext(): valid iff found, not revoked, not expired, and user.status === "ACTIVE". */
  function isSessionValid(session: { revokedAt: Date | null; expiresAt: Date; user: { status: string } } | null): boolean {
    if (!session || session.revokedAt || session.expiresAt < new Date()) return false;
    if (session.user.status !== "ACTIVE") return false;
    return true;
  }

  it("an unknown token hash resolves to no session (NOT FOUND case)", async () => {
    const found = await prisma.session.findUnique({
      where: { tokenHash: hashToken("__test__-token-that-was-never-issued") },
      include: { user: true },
    });
    expect(found).toBeNull();
    expect(isSessionValid(found)).toBe(false);
  });

  it("a session for a DISABLED user is invalid even though the session row itself is well-formed", async () => {
    const token = generateToken();
    await prisma.session.create({
      data: { userId: disabledUser.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const found = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    expect(found).not.toBeNull();
    expect(found!.revokedAt).toBeNull();
    expect(found!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(found!.user.status).toBe("DISABLED");
    expect(isSessionValid(found)).toBe(false);
  });

  it("a revoked session is invalid", async () => {
    const token = generateToken();
    await prisma.session.create({
      data: {
        userId: disabledUser.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
        revokedAt: new Date(),
      },
    });
    const found = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    expect(isSessionValid(found)).toBe(false);
  });

  it("an expired session is invalid", async () => {
    const token = generateToken();
    await prisma.session.create({
      data: { userId: disabledUser.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() - 1_000) },
    });
    const found = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    expect(isSessionValid(found)).toBe(false);
  });

  it("an active, unrevoked, unexpired session for an ACTIVE user is valid", async () => {
    const activeUser = await prisma.user.create({
      data: {
        firstName: "__TEST__",
        lastName: "Active",
        email: "__test__.auth.session.active@test.local",
        passwordHash: await hashPassword("__TEST__Whatever1"),
        status: "ACTIVE",
        color: "#666666",
      },
    });
    const token = generateToken();
    await prisma.session.create({
      data: { userId: activeUser.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const found = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    expect(isSessionValid(found)).toBe(true);

    await prisma.user.delete({ where: { id: activeUser.id } });
  });
});

describe("admin-managed password reset revokes active sessions (mirrors regenerateUserPassword/setUserPassword)", () => {
  const EMAIL = "__test__.auth.adminreset@test.local";
  let user: User;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    user = await prisma.user.create({
      data: {
        firstName: "__TEST__",
        lastName: "AdminReset",
        email: EMAIL,
        passwordHash: await hashPassword("__TEST__Whatever1"),
        color: "#999999",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  it("revoking all active sessions after a password change invalidates a previously valid session", async () => {
    const token = generateToken();
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const before = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(before?.revokedAt).toBeNull();

    // Same effect as regenerateUserPassword/setUserPassword: new hash + revoke active sessions.
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword("__TEST__NewOne1"), mustChangePassword: true } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    const after = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(after?.revokedAt).not.toBeNull();
  });
});
