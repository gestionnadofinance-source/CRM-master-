import "server-only";
import { prisma } from "@/lib/prisma";
import { listSilaeMappings } from "@/server/silae/actions";

/**
 * Données de la page Import Silae, partagées par les deux entrées :
 * /c/[crmSlug]/silae et /admin/silae. Les deux écrans affichent
 * exactement la même chose — les factoriser ici évite qu'ils divergent au
 * fil des évolutions.
 */
export async function loadSilaePageData(crmId: string) {
  const [mappings, accesses, acomptes, absences] = await Promise.all([
    listSilaeMappings(crmId),
    prisma.userCrmAccess.findMany({
      where: { crmId, user: { status: "ACTIVE" } },
      select: { userId: true, silaeMatricule: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.acompte.findMany({
      where: { crmId },
      orderBy: [{ payrollMonth: "desc" }, { paidOn: "desc" }],
      take: 100,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.absence.findMany({
      where: { crmId },
      orderBy: { startDate: "desc" },
      take: 100,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const now = new Date();
  // Mois proposé par défaut : le mois précédent, celui qu'on clôture.
  const defaultMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return {
    mappings,
    employees: accesses
      .map((a) => ({
        id: a.userId,
        name: `${a.user.firstName} ${a.user.lastName}`.trim(),
        matricule: a.silaeMatricule?.trim() || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    defaultMonth: `${defaultMonth.getUTCFullYear()}-${String(defaultMonth.getUTCMonth() + 1).padStart(2, "0")}`,
    acomptes: acomptes.map((a) => ({
      id: a.id,
      employeeName: `${a.user.firstName} ${a.user.lastName}`.trim(),
      amount: Number(a.amount),
      paidOn: a.paidOn.toISOString().slice(0, 10),
      payrollMonth: a.payrollMonth.toISOString().slice(0, 7),
      comment: a.comment,
    })),
    absences: absences.map((a) => ({
      id: a.id,
      employeeName: `${a.user.firstName} ${a.user.lastName}`.trim(),
      type: a.type,
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate.toISOString().slice(0, 10),
      hours: a.hours === null ? null : Number(a.hours),
      days: a.days === null ? null : Number(a.days),
      comment: a.comment,
    })),
  };
}
