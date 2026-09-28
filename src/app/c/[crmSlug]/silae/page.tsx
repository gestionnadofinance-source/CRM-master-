import { requireAuth } from "@/server/auth/session";
import { canManageOperations, requireCrmAccessBySlugOrNotFound } from "@/server/tenant";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { listSilaeMappings } from "@/server/silae/actions";
import { RUBRIQUES } from "@/server/silae/rubriques";
import { SilaeClient } from "./silae-client";

export default async function SilaePage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug);
  // Le layout filtre déjà la navigation, mais Next.js ne le réexécute pas
  // lors d'une navigation côté client : chaque page refait le contrôle.
  if (!canManageOperations(tenant)) notFound();

  const [mappings, accesses, acomptes, absences] = await Promise.all([
    listSilaeMappings(tenant.crmId),
    prisma.userCrmAccess.findMany({
      where: { crmId: tenant.crmId, user: { status: "ACTIVE" } },
      select: { userId: true, silaeMatricule: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.acompte.findMany({
      where: { crmId: tenant.crmId },
      orderBy: [{ payrollMonth: "desc" }, { paidOn: "desc" }],
      take: 100,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.absence.findMany({
      where: { crmId: tenant.crmId },
      orderBy: { startDate: "desc" },
      take: 100,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const employees = accesses
    .map((a) => ({
      id: a.userId,
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      matricule: a.silaeMatricule?.trim() || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const now = new Date();
  // Mois proposé par défaut : le mois précédent, celui qu'on clôture.
  const defaultMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Import Silae</h1>
        <p className="text-sm text-muted">
          Génère le fichier d&apos;éléments variables à importer dans Silae (Traitement Mois &gt; Import de données
          variables &gt; import standard « importsilae »). L&apos;export Excel reste disponible dans Comptabilité.
        </p>
      </div>

      <SilaeClient
        crmId={tenant.crmId}
        rubriques={RUBRIQUES.map((r) => ({ key: r.key, label: r.label, unit: r.unit, note: r.note ?? null }))}
        mappings={mappings}
        employees={employees}
        defaultMonth={`${defaultMonth.getUTCFullYear()}-${String(defaultMonth.getUTCMonth() + 1).padStart(2, "0")}`}
        acomptes={acomptes.map((a) => ({
          id: a.id,
          employeeName: `${a.user.firstName} ${a.user.lastName}`.trim(),
          amount: Number(a.amount),
          paidOn: a.paidOn.toISOString().slice(0, 10),
          payrollMonth: a.payrollMonth.toISOString().slice(0, 7),
          comment: a.comment,
        }))}
        absences={absences.map((a) => ({
          id: a.id,
          employeeName: `${a.user.firstName} ${a.user.lastName}`.trim(),
          type: a.type,
          startDate: a.startDate.toISOString().slice(0, 10),
          endDate: a.endDate.toISOString().slice(0, 10),
          hours: a.hours === null ? null : Number(a.hours),
          days: a.days === null ? null : Number(a.days),
          comment: a.comment,
        }))}
      />
    </div>
  );
}
