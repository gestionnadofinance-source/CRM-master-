/**
 * Nettoyage : suppression de tous les comptes sauf celui de l'administrateur
 * qui le lance.
 *
 * Le jeu de données reproduit tous les liens qui bloqueraient une suppression
 * naïve (chantier créé, fiche pointée comme chef, document déposé dans le
 * coffre du compte gardé, acompte et absence saisis, clé d'API) et vérifie
 * que les fichiers du stockage sont effacés avec les documents.
 *
 * Le cœur est appelé avec un filtre limité aux comptes de CE test, pour ne
 * jamais toucher aux comptes des autres fichiers ; le filtre de production
 * (tous sauf le compte gardé) est vérifié à part.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { getServerEnv } from "@/lib/env";
import { purgeTargets, purgeUsersCore } from "@/server/admin/purge-users";

const P = "__test__purge_";
let crmId = "";
let keepId = "";
let chantierId = "";
const ids: Record<string, string> = {};
const fichiers: string[] = [];

const fichierExiste = (key: string) => existsSync(path.resolve(getServerEnv().STORAGE_LOCAL_PATH, key));

beforeAll(async () => {
  const mk = (nom: string, isGlobalAdmin = false) =>
    prisma.user.create({ data: { email: `${P}${nom}@example.invalid`, firstName: nom, lastName: "T", passwordHash: "x", isGlobalAdmin } });
  const keep = await mk("admin", true);
  keepId = keep.id;
  for (const nom of ["chef", "ouvrier", "secretaire"]) ids[nom] = (await mk(nom)).id;

  const crm = await prisma.crm.create({ data: { slug: "__test__purge", name: "Test purge" } });
  crmId = crm.id;
  for (const nom of ["chef", "ouvrier", "secretaire"]) {
    await prisma.userCrmAccess.create({ data: { userId: ids[nom]!, crmId, category: nom === "secretaire" ? "SECRETAIRE" : "OUVRIER" } });
  }
  // Chantier créé par un compte qui va disparaître.
  const chantier = await prisma.chantier.create({
    data: { crmId, name: "Chantier purge", createdById: ids.secretaire!, startDate: new Date("2026-07-01"), endDate: new Date("2026-07-31") },
  });
  chantierId = chantier.id;
  await prisma.chantierAssignment.create({ data: { chantierId, userId: ids.ouvrier! } });
  // Pointage de l'ouvrier, saisi par le chef ; et une fiche du compte GARDÉ saisie par le chef.
  for (const employeeId of [ids.ouvrier!, keepId]) {
    await prisma.pointage.create({
      data: { crmId, chantierId, employeeId, foremanId: ids.chef!, weekStart: new Date("2026-07-06T00:00:00Z"), days: [] },
    });
  }
  // Coffre-fort : un document de l'ouvrier (fichier réel), et un document du
  // compte gardé, déposé par la secrétaire dans un dossier qu'elle a créé.
  const driver = getStorageDriver();
  const dossierGarde = await prisma.vaultFolder.create({ data: { crmId, ownerUserId: keepId, name: "Dossier", createdById: ids.secretaire! } });
  for (const [owner, folderId] of [[ids.ouvrier!, null], [keepId, dossierGarde.id]] as const) {
    const { storageKey } = await driver.put({ buffer: Buffer.from("pdf"), fileName: "fiche.pdf", crmId, mimeType: "application/pdf" });
    fichiers.push(storageKey);
    await prisma.vaultDocument.create({
      data: { crmId, userId: owner, fileName: "fiche.pdf", mimeType: "application/pdf", size: 3, storageKey, category: "PAYSLIP", uploadedById: ids.secretaire!, folderId },
    });
  }
  // Acompte et absence du compte gardé, saisis par la secrétaire ; clé d'API de la secrétaire.
  await prisma.acompte.create({
    data: { crmId, userId: keepId, amount: 100, paidOn: new Date(), payrollMonth: new Date(Date.UTC(2026, 6, 1)), createdById: ids.secretaire! },
  });
  await prisma.absence.create({
    data: { crmId, userId: keepId, type: "CONGE_PAYE", startDate: new Date(), endDate: new Date(), createdById: ids.secretaire! },
  });
  await prisma.apiKey.create({
    data: { name: "clé", keyHash: `${P}hash`, keyPrefix: "crm_x", createdById: ids.secretaire! },
  });
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  const driver = getStorageDriver();
  for (const f of fichiers) await driver.remove(f).catch(() => undefined);
});

describe("nettoyage des utilisateurs", () => {
  it("le filtre de production vise tous les comptes sauf celui conservé", () => {
    expect(purgeTargets("abc")).toEqual({ id: { not: "abc" } });
  });

  it("supprime les comptes et tout ce qui leur appartient, sans rien bloquer", async () => {
    const summary = await purgeUsersCore(keepId, { email: { startsWith: P } });
    expect(summary.deletedUsers).toBe(3);
    expect(summary.deletedEmails.sort()).toEqual([`${P}chef@example.invalid`, `${P}ouvrier@example.invalid`, `${P}secretaire@example.invalid`]);
    expect(summary.removedFiles).toBe(1);

    expect(await prisma.user.count({ where: { email: { startsWith: P } } })).toBe(1);
    expect(await prisma.userCrmAccess.count({ where: { crmId } })).toBe(0);
    expect(await prisma.chantierAssignment.count({ where: { chantierId } })).toBe(0);
    expect(await prisma.apiKey.count({ where: { keyHash: `${P}hash` } })).toBe(0);
    // Le document de l'ouvrier et son FICHIER ont disparu.
    expect(await prisma.vaultDocument.count({ where: { crmId, userId: { not: keepId } } })).toBe(0);
    expect(fichierExiste(fichiers[0]!)).toBe(false);
  });

  it("ce qui reste est rattaché au compte conservé", async () => {
    expect((await prisma.chantier.findUniqueOrThrow({ where: { id: chantierId } })).createdById).toBe(keepId);
    const pointages = await prisma.pointage.findMany({ where: { crmId } });
    expect(pointages.map((p) => [p.employeeId, p.foremanId])).toEqual([[keepId, keepId]]);
    const doc = await prisma.vaultDocument.findFirstOrThrow({ where: { crmId, userId: keepId } });
    expect(doc.uploadedById).toBe(keepId);
    expect(fichierExiste(fichiers[1]!)).toBe(true);
    expect((await prisma.vaultFolder.findFirstOrThrow({ where: { crmId } })).createdById).toBe(keepId);
    expect((await prisma.acompte.findFirstOrThrow({ where: { crmId } })).createdById).toBe(keepId);
    expect((await prisma.absence.findFirstOrThrow({ where: { crmId } })).createdById).toBe(keepId);
  });

  it("ne supprime jamais le compte conservé, même si le filtre l'inclut", async () => {
    const summary = await purgeUsersCore(keepId, { id: keepId });
    expect(summary.deletedUsers).toBe(0);
    expect(await prisma.user.count({ where: { id: keepId } })).toBe(1);
  });
});
