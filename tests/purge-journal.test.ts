/**
 * Purge du journal d'activité.
 *
 * Défaut relevé en phase d'endurance : une ligne est écrite à chaque
 * opération métier et rien ne l'élaguait, contrairement aux tables de
 * limitation de fréquence. Ce test vérifie les deux moitiés de la règle —
 * ce qui est assez vieux part, ce qui est récent reste — car une purge trop
 * large détruirait un historique qui a de la valeur métier.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { purgeOldActivityLogs } from "@/server/activity";
import { purgeExpiredSessions } from "@/server/auth/session";
import { hashPassword, hashToken, generateToken } from "@/lib/crypto";

const SLUG = "__test__purge_journal";
const JOUR_MS = 24 * 60 * 60 * 1000;

let crmId = "";

beforeAll(async () => {
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test Purge" } });
  crmId = crm.id;

  const lignes: Array<{ action: string; age: number }> = [
    { action: "tres_vieux", age: 800 },
    { action: "juste_au_dela", age: 366 },
    { action: "juste_en_deca", age: 364 },
    { action: "recent", age: 1 },
  ];
  for (const l of lignes) {
    await prisma.activityLog.create({
      data: {
        crmId,
        action: l.action,
        entityType: "Test",
        createdAt: new Date(Date.now() - l.age * JOUR_MS),
      },
    });
  }
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
});

describe("purge du journal d'activité", () => {
  it("supprime au-delà de 12 mois et conserve en deçà", async () => {
    const supprimees = await purgeOldActivityLogs();
    expect(supprimees).toBeGreaterThanOrEqual(2);

    const restantes = await prisma.activityLog.findMany({
      where: { crmId },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(restantes.map((r) => r.action)).toEqual(["juste_en_deca", "recent"]);
  });

  it("ne renvoie rien à purger au second passage", async () => {
    // Idempotence : la purge quotidienne ne doit pas retravailler sans cesse
    // les mêmes lignes.
    await purgeOldActivityLogs();
    expect(await purgeOldActivityLogs()).toBe(0);
  });
});

describe("purge des sessions périmées", () => {
  const EMAIL = "__test__purge_sessions@example.invalid";
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        firstName: "Test",
        lastName: "Sessions",
        passwordHash: await hashPassword("Test1234!"),
        mustChangePassword: false,
      },
    });
    userId = user.id;

    const sessions: Array<{ nom: string; expireIlYA: number; revoqueeIlYA?: number }> = [
      { nom: "tres_ancienne", expireIlYA: 90 },
      { nom: "juste_au_dela", expireIlYA: 31 },
      { nom: "expiree_recemment", expireIlYA: 2 },
      { nom: "revoquee_ancienne", expireIlYA: -1, revoqueeIlYA: 60 },
      { nom: "active", expireIlYA: -1 },
    ];
    for (const s of sessions) {
      await prisma.session.create({
        data: {
          userId,
          tokenHash: hashToken(`${generateToken()}-${s.nom}`),
          userAgent: s.nom,
          expiresAt: new Date(Date.now() - s.expireIlYA * JOUR_MS),
          revokedAt: s.revoqueeIlYA ? new Date(Date.now() - s.revoqueeIlYA * JOUR_MS) : null,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  it("efface au-delà de 30 jours et conserve ce qui est récent ou actif", async () => {
    await purgeExpiredSessions();
    const restantes = await prisma.session.findMany({
      where: { userId },
      select: { userAgent: true },
      orderBy: { createdAt: "asc" },
    });
    // Une session expirée depuis deux jours reste consultable (d'où l'on
    // s'est connecté), une session encore valide n'est évidemment pas touchée.
    expect(restantes.map((s) => s.userAgent).sort()).toEqual(["active", "expiree_recemment"]);
  });

  it("ne supprime jamais une session encore valide", async () => {
    await purgeExpiredSessions();
    const active = await prisma.session.findFirst({ where: { userId, userAgent: "active" } });
    expect(active).not.toBeNull();
    expect(active!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
