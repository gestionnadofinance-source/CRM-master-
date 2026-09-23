/**
 * Isolation des espaces — la propriété de correction la plus importante du
 * produit : un utilisateur de l'espace A ne doit jamais pouvoir lire ni
 * écrire les données de l'espace B, que ce soit par la garde de tenance
 * (src/server/tenant.ts), une requête Prisma directe, ou le scénario de
 * l'« identifiant deviné dans l'URL ».
 *
 * Tests d'intégration contre le vrai Postgres local via le client Prisma
 * partagé. Les fixtures sont créées ici et nettoyées dans afterAll ; rien
 * des espaces réels ni de l'administrateur réel n'est jamais lu ni modifié.
 * Toutes les lignes de fixture sont préfixées « __TEST__ » / « __test__ »,
 * si bien qu'un tir interrompu se rattrape de lui-même (beforeAll purge les
 * restes avant de recréer).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Chantier, Crm, Pointage, User, VaultDocument, VaultFolder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, type AuthContext, type SessionUser } from "@/server/auth/session";
import { assertBelongsToCrm, listAccessibleCrms, requireCrmAccess } from "@/server/tenant";
import { AccessCategory, CrmRole } from "@/server/permissions";

const SLUG_A = "__test__-isolation-crm-a";
const SLUG_B = "__test__-isolation-crm-b";
const EMAIL_A = "__test__.isolation.usera@test.local";
const EMAIL_B = "__test__.isolation.userb@test.local";
const EMAIL_ADMIN = "__test__.isolation.admin@test.local";

/** Construit l'AuthContext attendu par requireCrmAccess/listAccessibleCrms à partir d'une ligne User. */
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
  // La suppression d'un Crm cascade sur Chantier, Pointage, VaultFolder,
  // VaultDocument, Notification et UserCrmAccess.
  await prisma.crm.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B, EMAIL_ADMIN] } } });
}

describe("isolation des espaces", () => {
  let crmA: Crm;
  let crmB: Crm;
  let userA: User;
  let userB: User;
  let admin: User;
  let chantierA: Chantier;
  let chantierB: Chantier;
  let folderA: VaultFolder;
  let folderB: VaultFolder;
  let docA: VaultDocument;
  let docB: VaultDocument;
  let pointageA: Pointage;
  let pointageB: Pointage;

  beforeAll(async () => {
    await wipeFixtures();

    crmA = await prisma.crm.create({ data: { name: "__TEST__ Isolation A", slug: SLUG_A } });
    crmB = await prisma.crm.create({ data: { name: "__TEST__ Isolation B", slug: SLUG_B } });

    const mkUser = (email: string, last: string, isGlobalAdmin = false) =>
      prisma.user.create({
        data: { firstName: "__TEST__", lastName: last, email, passwordHash: "x", color: "#123456", isGlobalAdmin },
      });
    userA = await mkUser(EMAIL_A, "UserA");
    userB = await mkUser(EMAIL_B, "UserB");
    // L'administrateur global n'a volontairement AUCUNE ligne UserCrmAccess :
    // son accès est synthétique, ce qui doit rester vrai pour les deux espaces.
    admin = await mkUser(EMAIL_ADMIN, "Admin", true);

    await prisma.userCrmAccess.create({
      data: { userId: userA.id, crmId: crmA.id, role: CrmRole.MANAGER, category: AccessCategory.SECRETAIRE },
    });
    await prisma.userCrmAccess.create({
      data: { userId: userB.id, crmId: crmB.id, role: CrmRole.MANAGER, category: AccessCategory.SECRETAIRE },
    });

    const mkChantier = (crmId: string, userId: string, name: string) =>
      prisma.chantier.create({
        data: {
          crmId,
          name,
          startDate: new Date("2026-09-01"),
          endDate: new Date("2026-10-31"),
          createdById: userId,
        },
      });
    chantierA = await mkChantier(crmA.id, userA.id, "__TEST__ Chantier A");
    chantierB = await mkChantier(crmB.id, userB.id, "__TEST__ Chantier B");

    const mkFolder = (crmId: string, userId: string, name: string) =>
      prisma.vaultFolder.create({ data: { crmId, ownerUserId: userId, name, createdById: userId } });
    folderA = await mkFolder(crmA.id, userA.id, "__TEST__ Dossier A");
    folderB = await mkFolder(crmB.id, userB.id, "__TEST__ Dossier B");

    const mkDoc = (crmId: string, userId: string, folderId: string, fileName: string) =>
      prisma.vaultDocument.create({
        data: {
          crmId,
          userId,
          folderId,
          fileName,
          mimeType: "text/plain",
          size: 12,
          storageKey: `${crmId}/${fileName}`,
          category: "PAYSLIP",
          uploadedById: userId,
        },
      });
    docA = await mkDoc(crmA.id, userA.id, folderA.id, "__TEST__ doc-a.txt");
    docB = await mkDoc(crmB.id, userB.id, folderB.id, "__TEST__ doc-b.txt");

    const mkPointage = (crmId: string, chantierId: string, userId: string) =>
      prisma.pointage.create({
        data: {
          crmId,
          chantierId,
          employeeId: userId,
          foremanId: userId,
          weekStart: new Date("2026-09-07"),
          days: [],
        },
      });
    pointageA = await mkPointage(crmA.id, chantierA.id, userA.id);
    pointageB = await mkPointage(crmB.id, chantierB.id, userB.id);

    await prisma.notification.create({
      data: { crmId: crmA.id, userId: userA.id, type: "DOCUMENT_ADDED", title: "__TEST__ notif A" },
    });
    await prisma.notification.create({
      data: { crmId: crmB.id, userId: userB.id, type: "DOCUMENT_ADDED", title: "__TEST__ notif B" },
    });
  });

  afterAll(wipeFixtures);

  it("requireCrmAccess refuse à l'utilisateur A l'accès à l'espace B, avec le code CRM_ACCESS_DENIED", async () => {
    await expect(requireCrmAccess(toCtx(userA), crmB.id)).rejects.toMatchObject({ code: "CRM_ACCESS_DENIED" });
    await expect(requireCrmAccess(toCtx(userA), crmB.id)).rejects.toBeInstanceOf(AuthError);
  });

  it("requireCrmAccess refuse à l'utilisateur B l'accès à l'espace A", async () => {
    await expect(requireCrmAccess(toCtx(userB), crmA.id)).rejects.toMatchObject({ code: "CRM_ACCESS_DENIED" });
  });

  it("requireCrmAccess accorde à chacun l'accès à son propre espace", async () => {
    expect((await requireCrmAccess(toCtx(userA), crmA.id)).crmId).toBe(crmA.id);
    expect((await requireCrmAccess(toCtx(userB), crmB.id)).crmId).toBe(crmB.id);
  });

  it("listAccessibleCrms ne renvoie que les espaces sur lesquels l'utilisateur a un UserCrmAccess", async () => {
    const forA = (await listAccessibleCrms(toCtx(userA))).map((c) => c.id);
    const forB = (await listAccessibleCrms(toCtx(userB))).map((c) => c.id);

    expect(forA).toContain(crmA.id);
    expect(forA).not.toContain(crmB.id);
    expect(forB).toContain(crmB.id);
    expect(forB).not.toContain(crmA.id);
  });

  it("une requête Prisma cadrée par crmId ne traverse jamais les espaces (contrôle au niveau du schéma)", async () => {
    const chantiers = await prisma.chantier.findMany({ where: { crmId: crmA.id } });
    expect(chantiers.map((c) => c.id)).toEqual([chantierA.id]);

    const pointages = await prisma.pointage.findMany({ where: { crmId: crmA.id } });
    expect(pointages.map((p) => p.id)).toEqual([pointageA.id]);

    const documents = await prisma.vaultDocument.findMany({ where: { crmId: crmA.id } });
    expect(documents.map((d) => d.id)).toEqual([docA.id]);
  });

  describe("identifiant deviné dans l'URL", () => {
    it("assertBelongsToCrm rejette un identifiant de chantier d'un autre espace", async () => {
      const tenant = await requireCrmAccess(toCtx(userA), crmA.id);
      const guessed = await prisma.chantier.findUniqueOrThrow({ where: { id: chantierB.id } });
      expect(() => assertBelongsToCrm(guessed.crmId, tenant, "Chantier")).toThrow(AuthError);
    });

    it("assertBelongsToCrm rejette un identifiant de dossier de coffre-fort d'un autre espace", async () => {
      const tenant = await requireCrmAccess(toCtx(userA), crmA.id);
      const guessed = await prisma.vaultFolder.findUniqueOrThrow({ where: { id: folderB.id } });
      expect(() => assertBelongsToCrm(guessed.crmId, tenant, "Dossier")).toThrow(AuthError);
    });

    it("assertBelongsToCrm rejette un identifiant de document d'un autre espace", async () => {
      const tenant = await requireCrmAccess(toCtx(userA), crmA.id);
      const guessed = await prisma.vaultDocument.findUniqueOrThrow({ where: { id: docB.id } });
      expect(() => assertBelongsToCrm(guessed.crmId, tenant, "Document")).toThrow(AuthError);
    });

    it("assertBelongsToCrm rejette un identifiant de pointage d'un autre espace", async () => {
      const tenant = await requireCrmAccess(toCtx(userA), crmA.id);
      const guessed = await prisma.pointage.findUniqueOrThrow({ where: { id: pointageB.id } });
      expect(() => assertBelongsToCrm(guessed.crmId, tenant, "Pointage")).toThrow(AuthError);
    });

    it("assertBelongsToCrm accepte une ressource du propre espace de l'utilisateur", async () => {
      const tenant = await requireCrmAccess(toCtx(userA), crmA.id);
      expect(() => assertBelongsToCrm(chantierA.crmId, tenant, "Chantier")).not.toThrow();
    });
  });

  it("un utilisateur n'a jamais de notification rattachée à un espace auquel il n'appartient pas", async () => {
    const forA = await prisma.notification.findMany({ where: { userId: userA.id } });
    expect(forA).toHaveLength(1);
    expect(forA[0]!.crmId).toBe(crmA.id);
  });

  it("le coffre-fort d'un utilisateur n'expose jamais un document d'un autre espace, même par son propriétaire", async () => {
    // Le coffre-fort est cadré à la fois par espace ET par propriétaire :
    // les deux doivent tenir, un seul ne suffirait pas.
    const forA = await prisma.vaultDocument.findMany({ where: { crmId: crmA.id, userId: userA.id } });
    expect(forA.map((d) => d.id)).toEqual([docA.id]);

    const crossed = await prisma.vaultDocument.findMany({ where: { crmId: crmA.id, userId: userB.id } });
    expect(crossed).toHaveLength(0);
  });

  it("un administrateur global accède aux deux espaces via requireCrmAccess", async () => {
    const tenantA = await requireCrmAccess(toCtx(admin), crmA.id);
    const tenantB = await requireCrmAccess(toCtx(admin), crmB.id);

    expect(tenantA.crmId).toBe(crmA.id);
    expect(tenantA.isGlobalAdmin).toBe(true);
    expect(tenantB.crmId).toBe(crmB.id);
  });

  it("même pour un administrateur global, une requête cadrée sur l'espace A ne renvoie jamais de ligne de l'espace B", async () => {
    const tenant = await requireCrmAccess(toCtx(admin), crmA.id);
    const chantiers = await prisma.chantier.findMany({ where: { crmId: tenant.crmId } });

    expect(chantiers.map((c) => c.id)).toEqual([chantierA.id]);
    expect(chantiers.map((c) => c.id)).not.toContain(chantierB.id);
  });
});
