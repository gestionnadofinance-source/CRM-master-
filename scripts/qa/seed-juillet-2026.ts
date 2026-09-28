/**
 * Jeu de données FACTICE de juillet 2026 (environnement LOCAL uniquement).
 *
 * Chaque salarié porte un cas de test précis, pour que l'export Silae et le
 * tableau Excel soient éprouvés sur les situations qui cassent en vrai :
 *
 *   ALPHA   — trois semaines pleines, dont le mardi 14 juillet (férié) ;
 *   BRAVO   — semaine à cheval sur juin/juillet, 40 h (heures sup) ;
 *   CHARLIE — DEUX chantiers dans le mois, chacun avec frais SNCF et
 *             retenue de chambre : le cas qui perd de l'argent (BUG-005) ;
 *   DELTA   — des heures mais AUCUN matricule Silae : doit bloquer ;
 *   ECHO    — dimanche et nuit travaillés, une saisie négative et une
 *             semaine de 63 h : doit produire des avertissements.
 *
 * Idempotent. Tout est préfixé « QA » ou suffixé @qa.local, et supprimé par
 * scripts/qa/clean-qa.ts.
 */
import "dotenv/config";
import { createScriptPrismaClient } from "../../prisma/client";
import { hashPassword } from "../../src/lib/crypto";

const CRM_SLUG = "fidem-froid-clim";

/** 7 jours depuis un lundi ISO. `null` = non travaillé ; {nuit} = heures de nuit. */
function days(monday: string, perDay: Array<number | null | { jour?: number; nuit?: number }>) {
  const base = new Date(`${monday}T00:00:00Z`);
  return perDay.map((v, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    if (v === null) return { date, normal: 0, matin: 0, apresMidi: 0, nuit: 0 };
    if (typeof v === "number") return { date, normal: v, matin: 0, apresMidi: 0, nuit: 0 };
    return { date, normal: v.jour ?? 0, matin: 0, apresMidi: 0, nuit: v.nuit ?? 0 };
  });
}

const FULL_WEEK = [7, 7, 7, 7, 7, null, null] as const;

const EMPLOYEES = [
  { key: "alpha", last: "ALPHA", matricule: "1001" },
  { key: "bravo", last: "BRAVO", matricule: "1002" },
  { key: "charlie", last: "CHARLIE", matricule: "1003" },
  { key: "delta", last: "DELTA", matricule: null },
  { key: "echo", last: "ECHO", matricule: "1005" },
];

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();
  const crm = await prisma.crm.findUniqueOrThrow({ where: { slug: CRM_SLUG } });

  const foreman = await prisma.user.findUniqueOrThrow({ where: { email: "qa.chef@qa.local" } });
  const passwordHash = await hashPassword("QaTest1234!");

  // --- Salariés ------------------------------------------------------------
  const users = new Map<string, string>();
  for (const e of EMPLOYEES) {
    const user = await prisma.user.upsert({
      where: { email: `qa.${e.key}@qa.local` },
      update: { status: "ACTIVE" },
      create: {
        email: `qa.${e.key}@qa.local`,
        firstName: "QA",
        lastName: e.last,
        passwordHash,
        mustChangePassword: false,
      },
    });
    await prisma.userCrmAccess.upsert({
      where: { userId_crmId: { userId: user.id, crmId: crm.id } },
      update: { silaeMatricule: e.matricule, defaultDirtAllowance: 5, defaultHourlyRate: 12 },
      create: {
        userId: user.id,
        crmId: crm.id,
        category: "OUVRIER",
        silaeMatricule: e.matricule,
        defaultDirtAllowance: 5,
        defaultHourlyRate: 12,
      },
    });
    users.set(e.key, user.id);
  }

  // --- Chantiers -----------------------------------------------------------
  const chantiers: Record<string, string> = {};
  for (const [name, managementBonus] of [["QA Chantier 1", 100], ["QA Chantier 2", 50]] as const) {
    const existing = await prisma.chantier.findFirst({ where: { crmId: crm.id, name } });
    const data = {
      crmId: crm.id,
      name,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2026-08-31T00:00:00Z"),
      status: "IN_PROGRESS" as const,
      createdById: foreman.id,
      lunchAllowance: 20,
      mealAllowance: 0,
      managementBonus,
      clothingBonus: 0,
      maskBonus: 0,
      zoneBonus: 0,
      postBonus: 0,
      travelAllowance: 0,
      dinnerAllowance: 0,
    };
    const chantier = existing
      ? await prisma.chantier.update({ where: { id: existing.id }, data })
      : await prisma.chantier.create({ data });
    chantiers[name] = chantier.id;
  }

  // --- Affectations --------------------------------------------------------
  // Le chef de chantier doit être affecté pour pouvoir saisir les feuilles.
  const assign = async (chantierId: string, userId: string, extra: { sncfExpense?: number; roomDeduction?: number } = {}) => {
    await prisma.chantierAssignment.upsert({
      where: { chantierId_userId: { chantierId, userId } },
      update: extra,
      create: { chantierId, userId, ...extra },
    });
  };
  for (const id of Object.values(chantiers)) await assign(id, foreman.id);
  for (const key of ["alpha", "bravo", "delta", "echo"]) await assign(chantiers["QA Chantier 1"]!, users.get(key)!);
  // CHARLIE : deux chantiers, chacun avec ses frais d'affectation.
  await assign(chantiers["QA Chantier 1"]!, users.get("charlie")!, { sncfExpense: 120, roomDeduction: 50 });
  await assign(chantiers["QA Chantier 2"]!, users.get("charlie")!, { sncfExpense: 80, roomDeduction: 30 });

  // --- Feuilles de pointage ------------------------------------------------
  const sheets: Array<{ employee: string; chantier: string; monday: string; perDay: Parameters<typeof days>[1] }> = [
    { employee: "alpha", chantier: "QA Chantier 1", monday: "2026-07-06", perDay: [...FULL_WEEK] },
    { employee: "alpha", chantier: "QA Chantier 1", monday: "2026-07-13", perDay: [...FULL_WEEK] },
    { employee: "alpha", chantier: "QA Chantier 1", monday: "2026-07-20", perDay: [...FULL_WEEK] },
    // Lundi 29 et mardi 30 juin, puis mercredi 1er au vendredi 3 juillet : 40 h.
    { employee: "bravo", chantier: "QA Chantier 1", monday: "2026-06-29", perDay: [8, 8, 8, 8, 8, null, null] },
    { employee: "charlie", chantier: "QA Chantier 1", monday: "2026-07-06", perDay: [...FULL_WEEK] },
    { employee: "charlie", chantier: "QA Chantier 2", monday: "2026-07-20", perDay: [...FULL_WEEK] },
    { employee: "delta", chantier: "QA Chantier 1", monday: "2026-07-06", perDay: [...FULL_WEEK] },
    // Dimanche 12 juillet travaillé, nuit le jeudi.
    { employee: "echo", chantier: "QA Chantier 1", monday: "2026-07-06", perDay: [7, 7, 7, { nuit: 8 }, 7, null, 6] },
    { employee: "echo", chantier: "QA Chantier 1", monday: "2026-07-20", perDay: [13, 13, 13, 12, 12, null, null] },
    { employee: "echo", chantier: "QA Chantier 1", monday: "2026-07-27", perDay: [-3, 7, 7, 7, 7, null, null] },
  ];

  for (const s of sheets) {
    const employeeId = users.get(s.employee)!;
    const chantierId = chantiers[s.chantier]!;
    const weekStart = new Date(`${s.monday}T00:00:00Z`);
    await prisma.pointage.upsert({
      where: { chantierId_employeeId_weekStart: { chantierId, employeeId, weekStart } },
      update: { days: days(s.monday, s.perDay) },
      create: {
        crmId: crm.id,
        chantierId,
        employeeId,
        foremanId: foreman.id,
        weekStart,
        days: days(s.monday, s.perDay),
        hourlyRate: 12,
        nightRatePercent: 25,
        dirtAllowance: 5,
        lunchAllowanceApplied: true,
        managementBonusApplied: true,
      },
    });
  }

  // --- Un acompte, qui ne passe par aucun pointage -------------------------
  const alphaId = users.get("alpha")!;
  const payrollMonth = new Date(Date.UTC(2026, 6, 1));
  const already = await prisma.acompte.findFirst({ where: { crmId: crm.id, userId: alphaId, payrollMonth } });
  if (!already) {
    await prisma.acompte.create({
      data: {
        crmId: crm.id,
        userId: alphaId,
        amount: 300,
        paidOn: new Date("2026-07-15T00:00:00Z"),
        payrollMonth,
        createdById: foreman.id,
      },
    });
  }

  const count = await prisma.pointage.count({ where: { crmId: crm.id } });
  console.log(`OK — ${sheets.length} feuilles écrites, ${count} pointages dans l'espace ${CRM_SLUG}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
