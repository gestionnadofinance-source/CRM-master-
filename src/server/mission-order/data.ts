import "server-only";
import { prisma } from "@/lib/prisma";
import type { MissionOrderPdfData } from "@/server/mission-order/pdf";

/**
 * Rassemble les données de l'ordre de mission d'un salarié pour un chantier
 * donné : rien n'est stocké séparément, tout vient du chantier (fixe) et de
 * l'affectation (variable) — voir Chantier/ChantierAssignment. Retourne
 * `null` si le chantier, l'affectation ou le salarié est introuvable (rien
 * n'empêche de générer un ordre de mission partiel : les champs non
 * renseignés sont simplement omis du PDF).
 */
export async function loadMissionOrderData(chantierId: string, employeeId: string): Promise<MissionOrderPdfData | null> {
  const [chantier, assignment, employee] = await Promise.all([
    prisma.chantier.findUnique({ where: { id: chantierId }, include: { crm: { include: { companySettings: true } } } }),
    prisma.chantierAssignment.findUnique({ where: { chantierId_userId: { chantierId, userId: employeeId } } }),
    prisma.user.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } }),
  ]);
  if (!chantier || !assignment || !employee) return null;

  const settings = chantier.crm.companySettings;
  const distanceKm = Number(assignment.distanceKm ?? 0);
  const kmRate = Number(assignment.kmRate ?? 0);

  return {
    company: {
      legalName: settings?.legalName || chantier.crm.name,
      address: settings?.address || "",
      postalCode: settings?.postalCode || "",
      city: settings?.city || "",
      siret: settings?.siret || "",
      ape: settings?.ape || "",
      urssafOffice: settings?.urssafOffice || "",
      legalRepresentative: settings?.legalRepresentative || "",
      legalMentions: settings?.missionOrderLegalMentions || "",
      phone: settings?.phone || "",
      email: settings?.email || "",
    },
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeAddress: assignment.workerAddress,
    missionNature: chantier.missionNature,
    clientName: chantier.clientName,
    siteAddress: chantier.address,
    siteContactName: chantier.siteContactName,
    siteContactPhone: chantier.siteContactPhone,
    importantDocuments: chantier.importantDocuments,
    travelDate: assignment.startDate,
    travelDurationHours: Number(assignment.travelDurationHours ?? 0),
    travelAllowanceAmount: Number(chantier.travelAllowance),
    distanceKm,
    kmRate,
    kmAmount: Math.round(distanceKm * kmRate * 100) / 100,
    generatedAt: new Date(),
  };
}
