/**
 * Coffre-fort — autorisation de création/déplacement (voir
 * src/server/vault/core.ts, extrait de vault/actions.ts pour être
 * testable directement, sans passer par requireAuth()/next-headers).
 *
 * Couvre la logique ajoutée pour permettre au propriétaire d'un
 * coffre-fort de créer et déplacer ses propres fichiers/dossiers (jamais
 * renommer/supprimer), en plus de l'administration qui garde tous les
 * droits : la frontière propriétaire/admin/tiers, et la détection de
 * cycle sur le déplacement de dossiers.
 *
 * Intégration contre le vrai Postgres local, comme tests/isolation.test.ts —
 * fixtures namespacées "__TEST__" créées ici et nettoyées dans afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Crm, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessCategory, CrmRole } from "@/server/permissions";
import type { AuthContext, SessionUser } from "@/server/auth/session";
import { createVaultFolderCore, moveVaultDocumentCore, moveVaultFolderCore } from "@/server/vault/core";

// revalidatePath (Next.js App Router cache invalidation) requires a real
// request/render context ("static generation store") that only exists
// inside an actual Next.js request — never inside a plain Vitest process.
// It has no meaningful effect outside that context regardless, so it's
// stubbed out here rather than exercised — this mirrors how
// tests/stubs/server-only.ts neutralizes another build-only Next.js
// concern for the same reason.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SLUG = "__test__-vault-crm";
const EMAIL_OWNER = "__test__.vault.owner@test.local";
const EMAIL_OTHER = "__test__.vault.other@test.local";
const EMAIL_ADMIN = "__test__.vault.admin@test.local";

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
  if (crm) {
    await prisma.crm.delete({ where: { id: crm.id } }); // cascades VaultFolder/VaultDocument/UserCrmAccess
  }
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_OWNER, EMAIL_OTHER, EMAIL_ADMIN] } } });
}

describe("vault: création et déplacement (propriétaire vs. admin vs. tiers)", () => {
  let crm: Crm;
  let owner: User;
  let other: User;
  let admin: User;

  beforeAll(async () => {
    await wipeFixtures();
    crm = await prisma.crm.create({ data: { name: "__TEST__ Vault CRM", slug: SLUG } });
    owner = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Owner", email: EMAIL_OWNER, passwordHash: "x", color: "#111111" },
    });
    other = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Other", email: EMAIL_OTHER, passwordHash: "x", color: "#222222" },
    });
    admin = await prisma.user.create({
      data: { firstName: "__TEST__", lastName: "Admin", email: EMAIL_ADMIN, passwordHash: "x", isGlobalAdmin: true, color: "#333333" },
    });
    // owner/other ont accès au CRM (catégorie OUVRIER, sans MANAGE_SETTINGS) ;
    // admin passe par isGlobalAdmin, sans ligne UserCrmAccess (comme
    // isolation.test.ts), pour vérifier que le contrôle d'accès reste correct
    // même pour un accès synthétique.
    await prisma.userCrmAccess.create({
      data: { userId: owner.id, crmId: crm.id, role: CrmRole.USER, category: AccessCategory.OUVRIER },
    });
    await prisma.userCrmAccess.create({
      data: { userId: other.id, crmId: crm.id, role: CrmRole.USER, category: AccessCategory.OUVRIER },
    });
  });

  afterAll(wipeFixtures);

  describe("createVaultFolderCore", () => {
    it("permet au propriétaire de créer un dossier dans son propre coffre-fort", async () => {
      const res = await createVaultFolderCore(toCtx(owner), crm.id, owner.id, "__TEST__ Dossier perso", null);
      expect(res).toEqual({ ok: true });
    });

    it("refuse à un tiers (ni propriétaire, ni admin) de créer un dossier dans le coffre-fort d'un autre", async () => {
      const res = await createVaultFolderCore(toCtx(other), crm.id, owner.id, "__TEST__ Intrusion", null);
      expect(res.ok).toBe(false);
    });

    it("permet à un administrateur global de créer un dossier dans le coffre-fort de n'importe qui", async () => {
      const res = await createVaultFolderCore(toCtx(admin), crm.id, owner.id, "__TEST__ Dossier admin", null);
      expect(res).toEqual({ ok: true });
    });
  });

  describe("moveVaultDocumentCore", () => {
    it("permet au propriétaire de déplacer son propre document vers un de ses dossiers", async () => {
      const folderA = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ A", createdById: owner.id },
      });
      const folderB = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ B", createdById: owner.id },
      });
      const doc = await prisma.vaultDocument.create({
        data: {
          crmId: crm.id,
          userId: owner.id,
          fileName: "__test__.pdf",
          mimeType: "application/pdf",
          size: 10,
          storageKey: "__test__/vault-doc.pdf",
          folderId: folderA.id,
          uploadedById: owner.id,
        },
      });

      const res = await moveVaultDocumentCore(toCtx(owner), crm.id, doc.id, folderB.id);
      expect(res).toEqual({ ok: true });
      const updated = await prisma.vaultDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(updated.folderId).toBe(folderB.id);
    });

    it("refuse à un tiers de déplacer le document d'un autre", async () => {
      const doc = await prisma.vaultDocument.findFirstOrThrow({ where: { crmId: crm.id, userId: owner.id } });
      const res = await moveVaultDocumentCore(toCtx(other), crm.id, doc.id, null);
      expect(res.ok).toBe(false);
    });

    it("permet à un administrateur de déplacer le document de n'importe qui", async () => {
      const doc = await prisma.vaultDocument.findFirstOrThrow({ where: { crmId: crm.id, userId: owner.id } });
      const res = await moveVaultDocumentCore(toCtx(admin), crm.id, doc.id, null);
      expect(res).toEqual({ ok: true });
    });

    it("refuse de déplacer un document vers un dossier appartenant à quelqu'un d'autre", async () => {
      const doc = await prisma.vaultDocument.findFirstOrThrow({ where: { crmId: crm.id, userId: owner.id } });
      const otherFolder = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: other.id, name: "__TEST__ Coffre d'un autre", createdById: other.id },
      });
      const res = await moveVaultDocumentCore(toCtx(admin), crm.id, doc.id, otherFolder.id);
      expect(res.ok).toBe(false);
    });
  });

  describe("moveVaultFolderCore — détection de cycle", () => {
    it("refuse de déplacer un dossier dans lui-même", async () => {
      const folder = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Cycle Self", createdById: owner.id },
      });
      const res = await moveVaultFolderCore(toCtx(owner), crm.id, folder.id, folder.id);
      expect(res.ok).toBe(false);
    });

    it("refuse de déplacer un dossier dans l'un de ses propres sous-dossiers", async () => {
      const parent = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Parent", createdById: owner.id },
      });
      const child = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Enfant", createdById: owner.id, parentId: parent.id },
      });
      const grandchild = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Petit-enfant", createdById: owner.id, parentId: child.id },
      });

      const res = await moveVaultFolderCore(toCtx(owner), crm.id, parent.id, grandchild.id);
      expect(res.ok).toBe(false);
    });

    it("permet un déplacement valide (vers la racine) par le propriétaire", async () => {
      const parent = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Parent2", createdById: owner.id },
      });
      const child = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Enfant2", createdById: owner.id, parentId: parent.id },
      });
      const res = await moveVaultFolderCore(toCtx(owner), crm.id, child.id, null);
      expect(res).toEqual({ ok: true });
      const updated = await prisma.vaultFolder.findUniqueOrThrow({ where: { id: child.id } });
      expect(updated.parentId).toBeNull();
    });

    it("refuse à un tiers de déplacer le dossier d'un autre", async () => {
      const folder = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Dossier protégé", createdById: owner.id },
      });
      const res = await moveVaultFolderCore(toCtx(other), crm.id, folder.id, null);
      expect(res.ok).toBe(false);
    });

    it("permet à un administrateur de déplacer le dossier de n'importe qui", async () => {
      const folder = await prisma.vaultFolder.create({
        data: { crmId: crm.id, ownerUserId: owner.id, name: "__TEST__ Dossier admin move", createdById: owner.id },
      });
      const res = await moveVaultFolderCore(toCtx(admin), crm.id, folder.id, null);
      expect(res).toEqual({ ok: true });
    });
  });
});
