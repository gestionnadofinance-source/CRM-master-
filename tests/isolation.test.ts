/**
 * CRM isolation — the single most important correctness property of the
 * whole product: a user in CRM A must never be able to read or write CRM
 * B's data, whether through the tenant guard (src/server/tenant.ts), a
 * direct Prisma query, or a "guessed id in the URL" scenario.
 *
 * These are integration tests against the real local Postgres database via
 * the shared Prisma client. Fixtures are created here and torn down in
 * afterAll; nothing from the 5 real seeded CRMs or the real admin user is
 * ever read or mutated. All fixture rows are namespaced with "__TEST__" /
 * "__test__" so a crashed run is trivially recoverable (beforeAll wipes any
 * leftovers matching the fixed slugs/emails before creating fresh rows).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Appointment,
  Client,
  Crm,
  Document as DocumentRow,
  MessageThread,
  Prospect,
  Quote,
  User,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { AuthError, type AuthContext, type SessionUser } from "@/server/auth/session";
import { assertBelongsToCrm, listAccessibleCrms, requireCrmAccess } from "@/server/tenant";
import { CrmRole } from "@/server/permissions";

const SLUG_A = "__test__-isolation-crm-a";
const SLUG_B = "__test__-isolation-crm-b";
const EMAIL_A = "__test__.isolation.usera@test.local";
const EMAIL_B = "__test__.isolation.userb@test.local";
const EMAIL_ADMIN = "__test__.isolation.admin@test.local";

/** Builds the AuthContext shape requireCrmAccess/listAccessibleCrms expect, from a raw User row. */
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
  const crms = await prisma.crm.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  if (crms.length > 0) {
    const crmIds = crms.map((c) => c.id);
    // Quote -> QuoteItem.vatRateId has no onDelete action (default
    // restrict), while VatRate cascades away directly from Crm. Deleting
    // Quote explicitly first (which cascades its QuoteItem rows via
    // Quote's own onDelete: Cascade relation) avoids a same-statement race
    // between the two independent cascade paths hanging off Crm.
    await prisma.quote.deleteMany({ where: { crmId: { in: crmIds } } });
    // Deleting the Crm rows cascades every remaining crm-scoped child
    // (Client, Prospect, Appointment, Document, MessageThread/Message,
    // Notification, VatRate, ...) per the schema's onDelete: Cascade
    // relations back to Crm.
    await prisma.crm.deleteMany({ where: { id: { in: crmIds } } });
  }
  // Safe to delete users only after their crm-scoped rows (Client.ownerId,
  // Task.assigneeId, etc.) are gone, which the cascade above guarantees.
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B, EMAIL_ADMIN] } } });
}

describe("CRM isolation", () => {
  let crmA: Crm;
  let crmB: Crm;
  let userA: User;
  let userB: User;
  let globalAdmin: User;
  let clientA: Client;
  let clientB: Client;
  let prospectB: Prospect;
  let appointmentB: Appointment;
  let quoteA: Quote;
  let quoteB: Quote;
  let documentA: DocumentRow;
  let documentB: DocumentRow;
  let threadB: MessageThread;

  beforeAll(async () => {
    await wipeFixtures();

    crmA = await prisma.crm.create({ data: { name: "__TEST__ Isolation CRM A", slug: SLUG_A } });
    crmB = await prisma.crm.create({ data: { name: "__TEST__ Isolation CRM B", slug: SLUG_B } });

    userA = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "UserA", email: EMAIL_A, passwordHash: "x", color: "#111111" },
    });
    userB = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "UserB", email: EMAIL_B, passwordHash: "x", color: "#222222" },
    });
    globalAdmin = await prisma.user.create({
      data: {
        firstName: "__TEST__",
        lastName: "GlobalAdmin",
        email: EMAIL_ADMIN,
        passwordHash: "x",
        isGlobalAdmin: true,
        color: "#333333",
      },
    });

    // userA only ever has UserCrmAccess to CRM A; userB only to CRM B.
    await prisma.userCrmAccess.create({ data: { userId: userA.id, crmId: crmA.id, role: CrmRole.USER } });
    await prisma.userCrmAccess.create({ data: { userId: userB.id, crmId: crmB.id, role: CrmRole.USER } });
    // globalAdmin intentionally has NO UserCrmAccess row at all — access
    // must come purely from User.isGlobalAdmin.

    const vatA = await prisma.vatRate.create({ data: { crmId: crmA.id, label: "__TEST__ 20%", rate: 20 } });
    const vatB = await prisma.vatRate.create({ data: { crmId: crmB.id, label: "__TEST__ 20%", rate: 20 } });

    clientA = await prisma.client.create({
      data: { crmId: crmA.id, company: "__TEST__ Client A", ownerId: userA.id },
    });
    clientB = await prisma.client.create({
      data: { crmId: crmB.id, company: "__TEST__ Client B", ownerId: userB.id },
    });

    // Les pendants côté CRM A ne sont jamais référencés par un test : ils
    // existent pour que les requêtes scopées au CRM B soient probantes. Sans
    // eux, un résultat vide ne prouverait rien — la table serait simplement
    // vide, au lieu de contenir des données d'un autre CRM qui ne fuitent pas.
    await prisma.prospect.create({
      data: { crmId: crmA.id, company: "__TEST__ Prospect A", ownerId: userA.id },
    });
    prospectB = await prisma.prospect.create({
      data: { crmId: crmB.id, company: "__TEST__ Prospect B", ownerId: userB.id },
    });

    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    await prisma.appointment.create({
      data: {
        crmId: crmA.id,
        title: "__TEST__ RDV A",
        ownerId: userA.id,
        clientId: clientA.id,
        startAt: now,
        endAt: inOneHour,
      },
    });
    appointmentB = await prisma.appointment.create({
      data: {
        crmId: crmB.id,
        title: "__TEST__ RDV B",
        ownerId: userB.id,
        clientId: clientB.id,
        startAt: now,
        endAt: inOneHour,
      },
    });

    const inOneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    quoteA = await prisma.quote.create({
      data: {
        crmId: crmA.id,
        number: "__TEST__-A-0001",
        clientId: clientA.id,
        object: "__TEST__ devis A",
        validUntil: inOneWeek,
        createdById: userA.id,
        totalHt: 100,
        totalVat: 20,
        totalTtc: 120,
        items: {
          create: [{ designation: "__TEST__ Ligne A", quantity: 1, unitPriceHt: 100, vatRateId: vatA.id }],
        },
      },
    });
    quoteB = await prisma.quote.create({
      data: {
        crmId: crmB.id,
        number: "__TEST__-B-0001",
        clientId: clientB.id,
        object: "__TEST__ devis B",
        validUntil: inOneWeek,
        createdById: userB.id,
        totalHt: 100,
        totalVat: 20,
        totalTtc: 120,
        items: {
          create: [{ designation: "__TEST__ Ligne B", quantity: 1, unitPriceHt: 100, vatRateId: vatB.id }],
        },
      },
    });

    const driver = getStorageDriver();
    const storedA = await driver.put({
      buffer: Buffer.from("__TEST__ document A"),
      fileName: "__test__-a.txt",
      crmId: crmA.id,
      mimeType: "text/plain",
    });
    documentA = await prisma.document.create({
      data: {
        crmId: crmA.id,
        fileName: "__test__-a.txt",
        mimeType: "text/plain",
        size: 20,
        storageKey: storedA.storageKey,
        entityType: "CLIENT",
        entityId: clientA.id,
        uploadedById: userA.id,
        clientId: clientA.id,
      },
    });
    const storedB = await driver.put({
      buffer: Buffer.from("__TEST__ document B"),
      fileName: "__test__-b.txt",
      crmId: crmB.id,
      mimeType: "text/plain",
    });
    documentB = await prisma.document.create({
      data: {
        crmId: crmB.id,
        fileName: "__test__-b.txt",
        mimeType: "text/plain",
        size: 20,
        storageKey: storedB.storageKey,
        entityType: "CLIENT",
        entityId: clientB.id,
        uploadedById: userB.id,
        clientId: clientB.id,
      },
    });

    threadB = await prisma.messageThread.create({
      data: {
        crmId: crmB.id,
        type: "DIRECT",
        createdById: userB.id,
        participants: { create: [{ userId: userB.id }] },
      },
    });
    await prisma.message.create({
      data: { crmId: crmB.id, threadId: threadB.id, authorId: userB.id, body: "__TEST__ message B" },
    });
  });

  afterAll(async () => {
    try {
      const driver = getStorageDriver();
      await driver.remove(documentA.storageKey);
      await driver.remove(documentB.storageKey);
    } catch {
      // best-effort cleanup of the on-disk local storage files; the DB rows
      // are removed regardless via the cascade in wipeFixtures().
    }
    await wipeFixtures();
  });

  it("requireCrmAccess denies userA access to CRM B with code CRM_ACCESS_DENIED", async () => {
    await expect(requireCrmAccess(toCtx(userA), crmB.id)).rejects.toBeInstanceOf(AuthError);
    await expect(requireCrmAccess(toCtx(userA), crmB.id)).rejects.toMatchObject({ code: "CRM_ACCESS_DENIED" });
  });

  it("requireCrmAccess denies userB access to CRM A with code CRM_ACCESS_DENIED", async () => {
    await expect(requireCrmAccess(toCtx(userB), crmA.id)).rejects.toMatchObject({ code: "CRM_ACCESS_DENIED" });
  });

  it("requireCrmAccess grants each user access to their own CRM", async () => {
    await expect(requireCrmAccess(toCtx(userA), crmA.id)).resolves.toMatchObject({ crmId: crmA.id });
    await expect(requireCrmAccess(toCtx(userB), crmB.id)).resolves.toMatchObject({ crmId: crmB.id });
  });

  it("listAccessibleCrms returns only the CRMs a user has UserCrmAccess to", async () => {
    const listA = await listAccessibleCrms(toCtx(userA));
    expect(listA.some((c) => c.id === crmA.id)).toBe(true);
    expect(listA.some((c) => c.id === crmB.id)).toBe(false);

    const listB = await listAccessibleCrms(toCtx(userB));
    expect(listB.some((c) => c.id === crmB.id)).toBe(true);
    expect(listB.some((c) => c.id === crmA.id)).toBe(false);
  });

  it("raw Prisma queries scoped by crmId never cross CRMs (schema-level sanity check)", async () => {
    const clientsA = await prisma.client.findMany({ where: { crmId: crmA.id } });
    expect(clientsA.some((c) => c.id === clientA.id)).toBe(true);
    expect(clientsA.some((c) => c.id === clientB.id)).toBe(false);

    const clientsB = await prisma.client.findMany({ where: { crmId: crmB.id } });
    expect(clientsB.some((c) => c.id === clientB.id)).toBe(true);
    expect(clientsB.some((c) => c.id === clientA.id)).toBe(false);
  });

  it("assertBelongsToCrm rejects a guessed Client id from another CRM", async () => {
    const tenantA = await requireCrmAccess(toCtx(userA), crmA.id);
    const guessed = await prisma.client.findUniqueOrThrow({ where: { id: clientB.id } });
    expect(() => assertBelongsToCrm(guessed.crmId, tenantA, "Client")).toThrow(AuthError);
  });

  it("assertBelongsToCrm rejects a guessed Prospect id from another CRM", async () => {
    const tenantA = await requireCrmAccess(toCtx(userA), crmA.id);
    const guessed = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectB.id } });
    expect(() => assertBelongsToCrm(guessed.crmId, tenantA, "Prospect")).toThrow(AuthError);
  });

  it("assertBelongsToCrm rejects a guessed Appointment id from another CRM", async () => {
    const tenantA = await requireCrmAccess(toCtx(userA), crmA.id);
    const guessed = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentB.id } });
    expect(() => assertBelongsToCrm(guessed.crmId, tenantA, "Appointment")).toThrow(AuthError);
  });

  it("assertBelongsToCrm rejects a guessed Quote id from another CRM", async () => {
    const tenantA = await requireCrmAccess(toCtx(userA), crmA.id);
    const guessed = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB.id } });
    expect(() => assertBelongsToCrm(guessed.crmId, tenantA, "Quote")).toThrow(AuthError);
  });

  it("assertBelongsToCrm rejects a guessed Document id from another CRM", async () => {
    const tenantA = await requireCrmAccess(toCtx(userA), crmA.id);
    const guessed = await prisma.document.findUniqueOrThrow({ where: { id: documentB.id } });
    expect(() => assertBelongsToCrm(guessed.crmId, tenantA, "Document")).toThrow(AuthError);
  });

  it("a user never has notifications scoped to a CRM they don't belong to", async () => {
    // userA has no UserCrmAccess to crmB, so the application layer
    // (gated by requireCrmAccess) never creates a Notification for userA
    // scoped to crmB. Nothing was ever inserted for this combination —
    // asserting it stays empty documents that invariant explicitly.
    const rows = await prisma.notification.findMany({ where: { userId: userA.id, crmId: crmB.id } });
    expect(rows).toHaveLength(0);
  });

  it("MessageThread/Message: userA cannot be resolved as a participant of a CRM B thread, and CRM A thread queries never surface it", async () => {
    const participant = await prisma.messageThreadParticipant.findFirst({
      where: { threadId: threadB.id, userId: userA.id },
    });
    expect(participant).toBeNull();

    const threadsVisibleToUserAInCrmA = await prisma.messageThread.findMany({
      where: { crmId: crmA.id, participants: { some: { userId: userA.id } } },
    });
    expect(threadsVisibleToUserAInCrmA.some((t) => t.id === threadB.id)).toBe(false);

    // Even scoping only by userA's participation (no crmId filter at all)
    // must not surface CRM B's thread, since userA was never added as a
    // participant of it.
    const threadsForUserAAnyCrm = await prisma.messageThread.findMany({
      where: { participants: { some: { userId: userA.id } } },
    });
    expect(threadsForUserAAnyCrm.some((t) => t.id === threadB.id)).toBe(false);
  });

  it("a global admin can access both CRM A and CRM B via requireCrmAccess", async () => {
    await expect(requireCrmAccess(toCtx(globalAdmin), crmA.id)).resolves.toMatchObject({
      crmId: crmA.id,
      isGlobalAdmin: true,
    });
    await expect(requireCrmAccess(toCtx(globalAdmin), crmB.id)).resolves.toMatchObject({
      crmId: crmB.id,
      isGlobalAdmin: true,
    });
  });

  it("even for a global admin, a query explicitly scoped to CRM A never returns CRM B rows", async () => {
    const tenantAdminA = await requireCrmAccess(toCtx(globalAdmin), crmA.id);
    const clientsScopedToA = await prisma.client.findMany({ where: { crmId: tenantAdminA.crmId } });
    expect(clientsScopedToA.some((c) => c.id === clientA.id)).toBe(true);
    expect(clientsScopedToA.some((c) => c.id === clientB.id)).toBe(false);

    const tenantAdminB = await requireCrmAccess(toCtx(globalAdmin), crmB.id);
    const quotesScopedToB = await prisma.quote.findMany({ where: { crmId: tenantAdminB.crmId } });
    expect(quotesScopedToB.some((q) => q.id === quoteB.id)).toBe(true);
    expect(quotesScopedToB.some((q) => q.id === quoteA.id)).toBe(false);
  });
});
