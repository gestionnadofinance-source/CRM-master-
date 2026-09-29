/**
 * Dépôt de l'ordre de mission dans le coffre-fort du salarié.
 *
 * BUG-018 : l'ordre de mission n'était déposé que derrière un bouton, jamais
 * automatiquement à l'affectation — un ouvrier affecté sans clic n'en recevait
 * aucun. Ce test éprouve le cœur (depositMissionOrderCore) : il crée le
 * document, et une seconde affectation REMPLACE le précédent au lieu d'en
 * empiler un second (l'ancien deviendrait faux si l'adresse ou les km
 * changent).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import { depositMissionOrderCore } from "@/server/mission-order/core";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const SLUG = "__test__ordre_mission";
let crmId = "";
let chantierId = "";
let employeeId = "";
let tenant: { crmId: string; crmSlug: string };
let adminId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword("Test1234!");
  const admin = await prisma.user.create({
    data: { email: "__test__om_admin@example.invalid", firstName: "Test", lastName: "Admin", passwordHash, isGlobalAdmin: true, mustChangePassword: false },
  });
  adminId = admin.id;
  const emp = await prisma.user.create({
    data: { email: "__test__om_emp@example.invalid", firstName: "Ali", lastName: "OUVRIER", passwordHash, mustChangePassword: false },
  });
  employeeId = emp.id;
  const crm = await prisma.crm.create({ data: { slug: SLUG, name: "Test OM" } });
  crmId = crm.id;
  tenant = { crmId, crmSlug: SLUG };
  await prisma.userCrmAccess.create({ data: { userId: emp.id, crmId, category: "OUVRIER" } });
  const chantier = await prisma.chantier.create({
    data: { crmId, name: "Chantier OM", startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-08-31T00:00:00Z"), createdById: admin.id },
  });
  chantierId = chantier.id;
  await prisma.chantierAssignment.create({
    data: { chantierId, userId: emp.id, workerAddress: "1 rue A", kmRate: 0.5, distanceKm: 10 },
  });
});

afterAll(async () => {
  if (crmId) await prisma.crm.delete({ where: { id: crmId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__om_" } } });
});

describe("ordre de mission", () => {
  it("dépose un document MISSION_ORDER dans le coffre-fort du salarié", async () => {
    const res = await depositMissionOrderCore(tenant, adminId, chantierId, "Chantier OM", employeeId);
    expect(res.ok).toBe(true);
    const docs = await prisma.vaultDocument.findMany({ where: { crmId, userId: employeeId, category: "MISSION_ORDER" } });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.chantierId).toBe(chantierId);
  });

  it("remplace l'ordre précédent au lieu d'en empiler un second", async () => {
    // L'affectation change : nouvelle adresse. L'ancien ordre devient faux.
    await prisma.chantierAssignment.update({
      where: { chantierId_userId: { chantierId, userId: employeeId } },
      data: { workerAddress: "2 avenue B", distanceKm: 25 },
    });
    await depositMissionOrderCore(tenant, adminId, chantierId, "Chantier OM", employeeId);
    const docs = await prisma.vaultDocument.findMany({ where: { crmId, userId: employeeId, category: "MISSION_ORDER" } });
    expect(docs).toHaveLength(1); // un seul, pas deux
  });

  it("refuse si le salarié n'est pas affecté au chantier", async () => {
    const autre = await prisma.chantier.create({
      data: { crmId, name: "Autre", startDate: new Date("2026-07-01T00:00:00Z"), endDate: new Date("2026-08-31T00:00:00Z"), createdById: adminId },
    });
    const res = await depositMissionOrderCore(tenant, adminId, autre.id, "Autre", employeeId);
    expect(res.ok).toBe(false);
  });
});
