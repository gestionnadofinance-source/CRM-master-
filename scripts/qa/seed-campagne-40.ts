/**
 * Campagne à l'échelle : 40 salariés, 10 chantiers, un mois complet de
 * pointages (juillet 2026) — environnement LOCAL uniquement.
 *
 * Les fiches de pointage ne sont PAS écrites directement en base : elles
 * passent par l'API publique, qui appelle la vraie server action
 * upsertPointageEntry avec pour acteur le CRÉATEUR de la clé. La clé est donc
 * créée au nom du chef de chantier, ce qui soumet chaque écriture au contrôle
 * requireForeman (chef de chantier ET affecté à ce chantier) exactement comme
 * une saisie faite depuis son écran.
 *
 * Tout porte le suffixe @qa.local ou le préfixe « QA- » et se supprime avec
 * scripts/qa/clean-qa.ts.
 *
 * Usage : npx tsx scripts/qa/seed-campagne-40.ts [url de base]
 */
import "dotenv/config";
import { createScriptPrismaClient } from "../../prisma/client";
import { hashPassword, generateToken, hashToken } from "../../prisma/../src/lib/crypto";

const CRM_SLUG = "fidem-froid-clim";
const NB_SALARIES = 40;
const NB_CHANTIERS = 10;
const SEMAINES = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"];

/** Quatre profils d'horaires, pour couvrir les cas de calcul qui divergent. */
type Profil = 0 | 1 | 2 | 3;
function heuresDeLaSemaine(profil: Profil): Array<{ jour: number; nuit: number }> {
  switch (profil) {
    case 0: // 35 h pile : aucune heure supplémentaire
      return [7, 7, 7, 7, 7, 0, 0].map((h) => ({ jour: h, nuit: 0 }));
    case 1: // 40 h : 5 h dans la bande à 25 %
      return [8, 8, 8, 8, 8, 0, 0].map((h) => ({ jour: h, nuit: 0 }));
    case 2: // 49 h avec samedi : 8 h à 25 % puis 6 h à 50 %
      return [9, 9, 9, 9, 9, 4, 0].map((h) => ({ jour: h, nuit: 0 }));
    case 3: // nuit le jeudi, dimanche travaillé
      return [
        { jour: 7, nuit: 0 }, { jour: 7, nuit: 0 }, { jour: 7, nuit: 0 },
        { jour: 0, nuit: 8 }, { jour: 7, nuit: 0 }, { jour: 0, nuit: 0 }, { jour: 6, nuit: 0 },
      ];
  }
}

function jours(lundi: string, profil: Profil) {
  const base = new Date(`${lundi}T00:00:00Z`);
  return heuresDeLaSemaine(profil).map((h, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: h.jour, matin: 0, apresMidi: 0, nuit: h.nuit };
  });
}

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

async function main(): Promise<void> {
  const base = process.argv[2] ?? "http://localhost:3100";
  const prisma = createScriptPrismaClient();
  const crm = await prisma.crm.findUniqueOrThrow({ where: { slug: CRM_SLUG } });
  const passwordHash = await hashPassword("QaTest1234!");

  const creerCompte = async (
    email: string,
    firstName: string,
    lastName: string,
    opts: { isGlobalAdmin?: boolean; category?: "OUVRIER" | "SECRETAIRE" | "COMPTABLE"; isForeman?: boolean; matricule?: string } = {}
  ) => {
    const user = await prisma.user.upsert({
      where: { email },
      update: { status: "ACTIVE", mustChangePassword: false },
      create: { email, firstName, lastName, passwordHash, mustChangePassword: false, isGlobalAdmin: opts.isGlobalAdmin ?? false },
    });
    if (opts.category) {
      await prisma.userCrmAccess.upsert({
        where: { userId_crmId: { userId: user.id, crmId: crm.id } },
        update: { category: opts.category, isForeman: opts.isForeman ?? false, silaeMatricule: opts.matricule ?? null },
        create: {
          userId: user.id,
          crmId: crm.id,
          category: opts.category,
          isForeman: opts.isForeman ?? false,
          silaeMatricule: opts.matricule ?? null,
          defaultDirtAllowance: 5,
          defaultHourlyRate: 12,
        },
      });
    }
    return user;
  };

  // --- Comptes de rôle, pour l'épreuve des accès --------------------------
  const admin = await creerCompte("qa.admin@qa.local", "QA", "Admin", { isGlobalAdmin: true });
  const chef = await creerCompte("qa.chef@qa.local", "QA", "Chef", { category: "OUVRIER", isForeman: true, matricule: "2000" });
  const secretaire = await creerCompte("qa.secretaire@qa.local", "QA", "Secretaire", { category: "SECRETAIRE" });
  const comptable = await creerCompte("qa.comptable@qa.local", "QA", "Comptable", { category: "COMPTABLE" });
  const ouvrier = await creerCompte("qa.ouvrier@qa.local", "QA", "Ouvrier", { category: "OUVRIER" });

  // --- 40 salariés ---------------------------------------------------------
  const salaries = [];
  for (let i = 1; i <= NB_SALARIES; i++) {
    // Le salarié 40 n'a délibérément PAS de matricule Silae : il doit bloquer
    // la génération du fichier tant qu'il porte des heures.
    const matricule = i === NB_SALARIES ? undefined : String(2000 + i);
    salaries.push(
      await creerCompte(`qa.emp${deuxChiffres(i)}@qa.local`, "Salarié", `EMP${deuxChiffres(i)}`, {
        category: "OUVRIER",
        matricule,
      })
    );
  }

  // --- 10 chantiers, tous les champs renseignés ---------------------------
  const chantiers = [];
  for (let i = 1; i <= NB_CHANTIERS; i++) {
    const nom = `QA-C${deuxChiffres(i)}`;
    const donnees = {
      crmId: crm.id,
      name: nom,
      description: `Chantier de campagne n°${i} — rénovation d'installation frigorifique.`,
      address: `${i} rue de l'Essai, 3${deuxChiffres(i)}00 Ville-Test`,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2026-09-30T00:00:00Z"),
      color: ["#0891b2", "#be123c", "#15803d", "#a16207", "#6d28d9"][i % 5]!,
      status: (["PLANNED", "IN_PROGRESS", "COMPLETED"] as const)[i % 3]!,
      createdById: admin.id,
      // Indemnités et primes : montants ronds et distincts par chantier, pour
      // qu'une erreur d'affectation d'un montant à un chantier se voie.
      lunchAllowance: 20,
      dinnerAllowance: 15,
      travelAllowance: 10 + i,
      maskBonus: 5 + i,
      managementBonus: 100 + i,
      zoneBonus: 20 + i,
      postBonus: 30 + i,
      mealAllowance: 9.81,
      clothingBonus: 12,
      missionNature: `Maintenance frigorifique — lot ${i}`,
      clientName: `Client Test ${deuxChiffres(i)}`,
      siteContactName: `Contact Chantier ${deuxChiffres(i)}`,
      siteContactPhone: `01 23 45 ${deuxChiffres(i)} ${deuxChiffres(i)}`,
      importantDocuments: "Plan de prévention, PPSPS, habilitation fluides.",
    };
    const existant = await prisma.chantier.findFirst({ where: { crmId: crm.id, name: nom } });
    chantiers.push(
      existant
        ? await prisma.chantier.update({ where: { id: existant.id }, data: donnees })
        : await prisma.chantier.create({ data: donnees })
    );
  }

  // --- Affectations : 4 salariés par chantier, plus le chef partout -------
  const affecter = async (chantierId: string, userId: string, extra: Record<string, number | string> = {}) => {
    await prisma.chantierAssignment.upsert({
      where: { chantierId_userId: { chantierId, userId } },
      update: extra,
      create: { chantierId, userId, ...extra },
    });
  };
  for (const c of chantiers) await affecter(c.id, chef.id);

  for (let i = 0; i < salaries.length; i++) {
    const chantier = chantiers[i % NB_CHANTIERS]!;
    await affecter(chantier.id, salaries[i]!.id, {
      workerAddress: `${i + 1} avenue des Salariés, 75000 Paris`,
      kmRate: 0.5,
      distanceKm: 10 + (i % 20),
      travelHourlyRate: 11,
      travelDurationHours: 0.5 + (i % 3) * 0.25,
      sncfExpense: i % 5 === 0 ? 120 : 0,
      roomDeduction: i % 7 === 0 ? 60 : 0,
    });
  }

  // --- Clé API au nom du CHEF : les écritures suivent son contrôle d'accès -
  const cleEnClair = generateToken();
  await prisma.apiKey.deleteMany({ where: { name: "QA campagne 40" } });
  await prisma.apiKey.create({
    data: {
      name: "QA campagne 40",
      keyHash: hashToken(cleEnClair),
      keyPrefix: cleEnClair.slice(0, 6),
      permission: "READ_WRITE",
      createdById: chef.id,
    },
  });

  // --- 160 fiches de pointage, par la vraie action ------------------------
  let ecrites = 0;
  const echecs: string[] = [];
  for (let i = 0; i < salaries.length; i++) {
    const salarie = salaries[i]!;
    const chantier = chantiers[i % NB_CHANTIERS]!;
    const profil = (i % 4) as Profil;

    for (const lundi of SEMAINES) {
      const res = await fetch(`${base}/api/public/v1/pointages`, {
        method: "POST",
        headers: { authorization: `Bearer ${cleEnClair}`, "content-type": "application/json" },
        body: JSON.stringify({
          crmId: crm.id,
          chantierId: chantier.id,
          employeeId: salarie.id,
          weekStart: lundi,
          days: jours(lundi, profil),
          hourlyRate: 12 + (i % 5),
          nightRatePercent: 25,
          housingAllowance: i % 3 === 0 ? 40 : 0,
          dirtAllowance: 5,
          lunchAllowanceApplied: true,
          dinnerAllowanceApplied: profil === 3,
          travelAllowanceApplied: i % 2 === 0,
          maskBonusApplied: i % 3 === 0,
          managementBonusApplied: i % 4 === 0,
          zoneBonusApplied: i % 5 === 0,
          postBonusApplied: i % 6 === 0,
          kmReimbursementApplied: true,
          travelHoursReimbursementApplied: i % 2 === 1,
          mealAllowanceApplied: profil !== 0,
          clothingBonusApplied: i % 8 === 0,
          comments: `Campagne QA — salarié ${deuxChiffres(i + 1)}, semaine du ${lundi}.`,
        }),
      });
      if (res.status === 201) ecrites++;
      else echecs.push(`${salarie.email} ${lundi} → ${res.status} ${(await res.text()).slice(0, 80)}`);
    }
  }

  // --- Sessions pour l'épreuve des accès ----------------------------------
  const sessions: Array<{ profil: string; token: string }> = [];
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  for (const [profil, user] of [
    ["ADMIN", admin],
    ["CHEF", chef],
    ["SECRETAIRE", secretaire],
    ["COMPTABLE", comptable],
    ["OUVRIER", ouvrier],
    ["SALARIE_01", salaries[0]!],
    ["SALARIE_02", salaries[1]!],
  ] as const) {
    const token = generateToken();
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
    sessions.push({ profil, token });
  }

  console.log(
    JSON.stringify(
      {
        crmId: crm.id,
        crmSlug: CRM_SLUG,
        salaries: salaries.length,
        chantiers: chantiers.length,
        fichesAttendues: salaries.length * SEMAINES.length,
        fichesEcrites: ecrites,
        echecs: echecs.slice(0, 10),
        cleApi: cleEnClair,
        chefId: chef.id,
        chantierIds: chantiers.map((c) => ({ nom: c.name, id: c.id })),
        sessions,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
