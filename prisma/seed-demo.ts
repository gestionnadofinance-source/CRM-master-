/**
 * Données de démonstration pour CRM Master.
 *
 * Crée, pour chacun des 5 CRM déjà seedés par `prisma/seed.ts`, un jeu de
 * données réaliste (utilisateurs commerciaux, clients, prospects,
 * opportunités, rendez-vous, tâches, devis) clairement identifiable et
 * supprimable séparément des données réelles :
 *
 *   - toute entreprise (Client/Prospect) porte le préfixe "[DEMO] " dans
 *     son nom, tout objet de devis porte aussi ce préfixe ;
 *   - tout utilisateur de démonstration a un email se terminant par
 *     "@demo.crm-master.local" (jamais un domaine qui pourrait ressembler
 *     à un vrai utilisateur).
 *
 * `prisma/clear-demo.ts` supprime tout ce qui correspond à ces deux
 * conventions, et uniquement cela — jamais les 5 CRM réels, l'admin
 * global, ni aucune donnée non préfixée.
 *
 * Ce script est idempotent : le relancer plusieurs fois ne duplique rien
 * (upsert pour les utilisateurs/accès, vérification d'existence par nom
 * pour clients/prospects, plafond de quantité par CRM pour
 * opportunités/rendez-vous/tâches/devis qui n'ont pas de clé naturelle).
 *
 * Usage : npm run seed:demo
 */
import {
  AppointmentStatus,
  CrmRole,
  ClientStatus,
  PrismaClient,
  ProspectStatus,
  QuoteStatus,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "DemoPass123!";
const DEMO_EMAIL_DOMAIN = "demo.crm-master.local";
const DEMO_PREFIX = "[DEMO] ";

const CLIENTS_PER_CRM = 10;
const PROSPECTS_PER_CRM = 10;
const OPPORTUNITIES_PER_CRM = 6;
const APPOINTMENTS_PER_CRM = 6;
const TASKS_PER_CRM = 8;
const QUOTES_PER_CRM = 3;

// ============================================================================
// POOL D'UTILISATEURS DE DÉMONSTRATION
// Réutilisés entre CRM pour illustrer le cas "Utilisateur A a accès à
// Fidem Froid Clim + Fidem Maintenance" du cahier des charges. Chaque CRM
// se retrouve avec 3 utilisateurs démo assignés.
// ============================================================================

interface DemoUserDef {
  firstName: string;
  lastName: string;
  localPart: string;
  color: string;
  access: { slug: string; role: CrmRole }[];
}

const DEMO_USERS: DemoUserDef[] = [
  {
    firstName: "Julie",
    lastName: "Bernard",
    localPart: "julie.bernard",
    color: "#2563eb",
    access: [
      { slug: "fidem-froid-clim", role: CrmRole.MANAGER },
      { slug: "fidem-maintenance", role: CrmRole.USER },
    ],
  },
  {
    firstName: "Marc",
    lastName: "Lefèvre",
    localPart: "marc.lefevre",
    color: "#f97316",
    access: [
      { slug: "fidem-froid-clim", role: CrmRole.USER },
      { slug: "fidem-maintenance", role: CrmRole.USER },
    ],
  },
  {
    firstName: "Sophie",
    lastName: "Rousseau",
    localPart: "sophie.rousseau",
    color: "#16a34a",
    access: [{ slug: "fidem-froid-clim", role: CrmRole.USER }],
  },
  {
    firstName: "Thomas",
    lastName: "Petit",
    localPart: "thomas.petit",
    color: "#0891b2",
    access: [{ slug: "fidem-maintenance", role: CrmRole.MANAGER }],
  },
  {
    firstName: "Camille",
    lastName: "Dubois",
    localPart: "camille.dubois",
    color: "#dc2626",
    access: [
      { slug: "fitness-park-modge", role: CrmRole.MANAGER },
      { slug: "association", role: CrmRole.USER },
    ],
  },
  {
    firstName: "Antoine",
    lastName: "Moreau",
    localPart: "antoine.moreau",
    color: "#9333ea",
    access: [
      { slug: "fitness-park-modge", role: CrmRole.USER },
      { slug: "societe-communication", role: CrmRole.USER },
    ],
  },
  {
    firstName: "Léa",
    lastName: "Girard",
    localPart: "lea.girard",
    color: "#ca8a04",
    access: [{ slug: "fitness-park-modge", role: CrmRole.USER }],
  },
  {
    firstName: "Nicolas",
    lastName: "Fontaine",
    localPart: "nicolas.fontaine",
    color: "#7c3aed",
    access: [{ slug: "association", role: CrmRole.MANAGER }],
  },
  {
    firstName: "Élodie",
    lastName: "Faure",
    localPart: "elodie.faure",
    color: "#0d9488",
    access: [
      { slug: "association", role: CrmRole.USER },
      { slug: "societe-communication", role: CrmRole.MANAGER },
    ],
  },
  {
    firstName: "Hugo",
    lastName: "Lambert",
    localPart: "hugo.lambert",
    color: "#d97706",
    access: [{ slug: "societe-communication", role: CrmRole.USER }],
  },
];

// ============================================================================
// GÉNÉRATION DE DONNÉES RÉALISTES (noms d'entreprise, contacts, adresses)
// ============================================================================

const COMPANY_TYPES = [
  "Boulangerie", "Garage", "Cabinet Comptable", "Restaurant", "Pharmacie",
  "Menuiserie", "Salon de Coiffure", "Cabinet Dentaire", "Auto-École", "Fleuriste",
  "Boucherie", "Librairie-Papeterie", "Institut de Beauté", "Cabinet d'Architecture", "Épicerie Fine",
  "Agence Immobilière", "Traiteur", "Atelier de Couture", "Bureau d'Études", "Imprimerie",
  "Cabinet d'Avocats", "Supérette", "Pressing", "Opticien", "Cabinet Vétérinaire",
  "Hôtel-Restaurant", "Serrurerie", "Électricité Générale", "Plomberie", "Cabinet de Kinésithérapie",
  "Crèche", "École de Danse", "Club de Sport", "Centre de Formation", "Agence de Voyage",
  "Cabinet de Conseil", "Studio Photo", "Concession Automobile", "Cabinet d'Expertise", "Auto-Moto École",
];
const COMPANY_SURNAMES = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Petit", "Durand", "Leroy", "Moreau", "Simon",
  "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel",
  "Girard", "André", "Lefèvre", "Mercier", "Dupont", "Lambert", "Bonnet", "François", "Rousseau", "Blanc",
];
const CITIES = [
  { city: "Lyon", postal: "69001" }, { city: "Marseille", postal: "13001" }, { city: "Toulouse", postal: "31000" },
  { city: "Nantes", postal: "44000" }, { city: "Bordeaux", postal: "33000" }, { city: "Lille", postal: "59000" },
  { city: "Strasbourg", postal: "67000" }, { city: "Rennes", postal: "35000" }, { city: "Montpellier", postal: "34000" },
  { city: "Nice", postal: "06000" }, { city: "Grenoble", postal: "38000" }, { city: "Dijon", postal: "21000" },
  { city: "Angers", postal: "49000" }, { city: "Le Mans", postal: "72000" }, { city: "Reims", postal: "51100" },
];
const PERSON_FIRST_NAMES = [
  "Jean", "Marie", "Pierre", "Isabelle", "Philippe", "Nathalie", "Alain", "Catherine", "Michel", "Sylvie",
  "Christophe", "Valérie", "Patrick", "Sandrine", "Éric", "Céline", "Olivier", "Stéphanie", "Laurent", "Aurélie",
];

let nameCursor = 0;
const usedCompanyNames = new Set<string>();
function nextCompanyName(): string {
  for (;;) {
    const type = COMPANY_TYPES[nameCursor % COMPANY_TYPES.length]!;
    const surname = COMPANY_SURNAMES[Math.floor(nameCursor / COMPANY_TYPES.length) % COMPANY_SURNAMES.length]!;
    nameCursor++;
    const name = `${type} ${surname}`;
    if (!usedCompanyNames.has(name)) {
      usedCompanyNames.add(name);
      return name;
    }
  }
}

function fakeSiret(seed: number): string {
  const siren = String(480000000 + seed).padStart(9, "0").slice(0, 9);
  const nic = String((seed % 90000) + 10000).padStart(5, "0");
  return `${siren}${nic}`;
}

function slugifyForEmail(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function fakePhone(seed: number): string {
  const n = String(10000000 + (seed * 37) % 89999999).padStart(8, "0");
  return `06 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)}`;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ============================================================================
// MAIN
// ============================================================================

interface RunTotals {
  usersCreated: number;
  usersExisting: number;
  clientsCreated: number;
  clientsExisting: number;
  prospectsCreated: number;
  prospectsExisting: number;
  opportunitiesCreated: number;
  appointmentsCreated: number;
  tasksCreated: number;
  quotesCreated: number;
}

async function ensureDemoUsers(): Promise<Map<string, { id: string }>> {
  const byLocalPart = new Map<string, { id: string }>();
  for (const def of DEMO_USERS) {
    const email = `${def.localPart}@${DEMO_EMAIL_DOMAIN}`;
    const existing = await prisma.user.findUnique({ where: { email } });
    let user: { id: string };
    if (existing) {
      user = existing;
      totals.usersExisting++;
    } else {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
      user = await prisma.user.create({
        data: {
          firstName: def.firstName,
          lastName: def.lastName,
          email,
          passwordHash,
          color: def.color,
          mustChangePassword: false,
        },
      });
      totals.usersCreated++;
    }
    byLocalPart.set(def.localPart, user);

    for (const grant of def.access) {
      const crm = await prisma.crm.findUnique({ where: { slug: grant.slug } });
      if (!crm) continue;
      await prisma.userCrmAccess.upsert({
        where: { userId_crmId: { userId: user.id, crmId: crm.id } },
        update: {},
        create: { userId: user.id, crmId: crm.id, role: grant.role },
      });
    }
  }
  return byLocalPart;
}

const totals: RunTotals = {
  usersCreated: 0,
  usersExisting: 0,
  clientsCreated: 0,
  clientsExisting: 0,
  prospectsCreated: 0,
  prospectsExisting: 0,
  opportunitiesCreated: 0,
  appointmentsCreated: 0,
  tasksCreated: 0,
  quotesCreated: 0,
};

async function nextQuoteNumber(crmId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Reprend le préfixe déjà attribué à ce CRM par prisma/seed.ts (chaque
  // CRM y est seedé avec un QuoteCounter) plutôt que d'en inventer un.
  const existingCounter = await prisma.quoteCounter.findFirst({ where: { crmId }, orderBy: { year: "desc" } });
  const prefix = existingCounter?.prefix ?? "DEVIS";
  const counter = await prisma.quoteCounter.upsert({
    where: { crmId_prefix_year: { crmId, prefix, year } },
    create: { crmId, prefix, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(counter.lastNumber).padStart(5, "0")}`;
}

async function seedCrm(slug: string, usersByLocalPart: Map<string, { id: string }>): Promise<void> {
  const crm = await prisma.crm.findUnique({ where: { slug } });
  if (!crm) {
    console.warn(`  ! CRM introuvable pour le slug "${slug}", ignoré (le seed de base a-t-il tourné ?).`);
    return;
  }

  const crmUserDefs = DEMO_USERS.filter((d) => d.access.some((a) => a.slug === slug));
  const crmUsers = crmUserDefs.map((d) => usersByLocalPart.get(d.localPart)!).filter(Boolean);
  if (crmUsers.length === 0) {
    console.warn(`  ! Aucun utilisateur démo rattaché à ${crm.name}, ignoré.`);
    return;
  }

  const sources = await prisma.source.findMany({ where: { crmId: crm.id }, orderBy: { order: "asc" } });
  const vatRates = await prisma.vatRate.findMany({ where: { crmId: crm.id } });
  const defaultVat = vatRates.find((v) => v.isDefault) ?? vatRates[0];
  const reducedVat = vatRates.find((v) => !v.isDefault) ?? defaultVat;
  const stages = await prisma.pipelineStage.findMany({ where: { crmId: crm.id }, orderBy: { order: "asc" } });
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const wonStage = stages.find((s) => s.isWon);
  const lostStage = stages.find((s) => s.isLost);

  let crmClientsCreated = 0;
  let crmProspectsCreated = 0;

  // -- Clients --------------------------------------------------------
  const clients: { id: string; company: string }[] = [];
  for (let i = 0; i < CLIENTS_PER_CRM; i++) {
    const baseName = nextCompanyName();
    const company = `${DEMO_PREFIX}${baseName}`;
    const existing = await prisma.client.findFirst({ where: { crmId: crm.id, company } });
    if (existing) {
      clients.push(existing);
      totals.clientsExisting++;
      continue;
    }
    const cityInfo = CITIES[(nameCursor + i) % CITIES.length]!;
    const owner = crmUsers[i % crmUsers.length]!;
    const source = sources.length > 0 ? sources[i % sources.length]! : undefined;
    const seed = nameCursor + i * 13;
    const person = {
      first: PERSON_FIRST_NAMES[i % PERSON_FIRST_NAMES.length]!,
      last: COMPANY_SURNAMES[(i * 3) % COMPANY_SURNAMES.length]!,
    };
    const client = await prisma.client.create({
      data: {
        crmId: crm.id,
        company,
        sector: baseName.split(" ")[0],
        firstName: person.first,
        lastName: person.last,
        phone: fakePhone(seed),
        email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}@${slugifyForEmail(baseName)}.fr`,
        address: `${12 + (seed % 80)} rue de la République, ${cityInfo.postal} ${cityInfo.city}`,
        activity: baseName.split(" ")[0],
        size: ["1-9", "10-49", "50-249"][i % 3],
        siret: fakeSiret(seed),
        status: i % 5 === 0 ? ClientStatus.INACTIVE : ClientStatus.ACTIVE,
        notes: "Client de démonstration — données fictives générées par prisma/seed-demo.ts.",
        sourceId: source?.id,
        ownerId: owner.id,
        commercialValue: 1000 + (seed % 20) * 500,
        revenue: 50000 + (seed % 30) * 10000,
        lastContactAt: daysFromNow(-(seed % 30)),
        nextContactAt: daysFromNow((seed % 20) + 1),
      },
    });
    clients.push(client);
    totals.clientsCreated++;
    crmClientsCreated++;
  }

  // -- Prospects --------------------------------------------------------
  const prospects: { id: string; company: string }[] = [];
  const prospectStatuses = [
    ProspectStatus.HOT, ProspectStatus.COLD, ProspectStatus.TO_FOLLOW_UP, ProspectStatus.LOST, ProspectStatus.TO_FOLLOW_UP,
  ];
  for (let i = 0; i < PROSPECTS_PER_CRM; i++) {
    const baseName = nextCompanyName();
    const company = `${DEMO_PREFIX}${baseName}`;
    const existing = await prisma.prospect.findFirst({ where: { crmId: crm.id, company } });
    if (existing) {
      prospects.push(existing);
      totals.prospectsExisting++;
      continue;
    }
    const cityInfo = CITIES[(nameCursor + i + 5) % CITIES.length]!;
    const owner = crmUsers[(i + 1) % crmUsers.length]!;
    const source = sources.length > 0 ? sources[(i + 3) % sources.length]! : undefined;
    const seed = nameCursor + i * 17;
    const status = prospectStatuses[i % prospectStatuses.length]!;
    const person = {
      first: PERSON_FIRST_NAMES[(i + 4) % PERSON_FIRST_NAMES.length]!,
      last: COMPANY_SURNAMES[(i * 5 + 2) % COMPANY_SURNAMES.length]!,
    };
    const prospect = await prisma.prospect.create({
      data: {
        crmId: crm.id,
        company,
        firstName: person.first,
        lastName: person.last,
        phone: fakePhone(seed),
        email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}@${slugifyForEmail(baseName)}.fr`,
        address: `${5 + (seed % 60)} avenue de la Gare, ${cityInfo.postal} ${cityInfo.city}`,
        siret: fakeSiret(seed + 1),
        sector: baseName.split(" ")[0],
        activity: baseName.split(" ")[0],
        size: ["1-9", "10-49", "50-249"][i % 3],
        sourceId: source?.id,
        ownerId: owner.id,
        status,
        score: 20 + (seed % 80),
        potentialAmount: 2000 + (seed % 25) * 800,
        notes: "Prospect de démonstration — données fictives générées par prisma/seed-demo.ts.",
        lastContactAt: daysFromNow(-(seed % 25)),
        nextContactAt: status === ProspectStatus.LOST ? null : daysFromNow((seed % 15) + 1),
        lostReason: status === ProspectStatus.LOST ? "Budget insuffisant (démo)" : null,
      },
    });
    prospects.push(prospect);
    totals.prospectsCreated++;
    crmProspectsCreated++;
  }

  // -- Opportunités -----------------------------------------------------
  let opportunitiesCreated = 0;
  const existingOpportunities = await prisma.opportunity.count({
    where: { crmId: crm.id, title: { startsWith: DEMO_PREFIX } },
  });
  for (let i = existingOpportunities; i < OPPORTUNITIES_PER_CRM; i++) {
    const useClient = i % 2 === 0 && clients.length > 0;
    const targetClient = useClient ? clients[i % clients.length] : undefined;
    const targetProspect = !useClient && prospects.length > 0 ? prospects[i % prospects.length] : undefined;
    const owner = crmUsers[i % crmUsers.length]!;
    const seed = i * 23 + 7;
    // Répartit sur le pipeline : une partie ouverte, une partie gagnée, une partie perdue.
    let stage = openStages[i % Math.max(openStages.length, 1)];
    let wonAt: Date | null = null;
    let lostAt: Date | null = null;
    if (i === OPPORTUNITIES_PER_CRM - 1 && wonStage) {
      stage = wonStage;
      wonAt = daysFromNow(-(seed % 15));
    } else if (i === OPPORTUNITIES_PER_CRM - 2 && lostStage) {
      stage = lostStage;
      lostAt = daysFromNow(-(seed % 20));
    }
    if (!stage) continue;
    await prisma.opportunity.create({
      data: {
        crmId: crm.id,
        stageId: stage.id,
        clientId: targetClient?.id,
        prospectId: targetProspect?.id,
        title: `${DEMO_PREFIX}Opportunité ${targetClient?.company ?? targetProspect?.company ?? "(démo)"}`,
        amount: 1500 + (seed % 30) * 700,
        ownerId: owner.id,
        position: i,
        nextAction: wonAt || lostAt ? null : "Relancer par téléphone",
        lastActivityAt: daysFromNow(-(seed % 10)),
        wonAt,
        lostAt,
        lostReason: lostAt ? "Choix d'un concurrent (démo)" : null,
      },
    });
    opportunitiesCreated++;
    totals.opportunitiesCreated++;
  }

  // -- Rendez-vous --------------------------------------------------------
  let appointmentsCreated = 0;
  const existingAppointments = await prisma.appointment.count({
    where: { crmId: crm.id, title: { startsWith: DEMO_PREFIX } },
  });
  for (let i = existingAppointments; i < APPOINTMENTS_PER_CRM; i++) {
    const isPast = i % 2 === 0;
    const owner = crmUsers[i % crmUsers.length]!;
    const useClient = i % 2 === 0 && clients.length > 0;
    const targetClient = useClient ? clients[i % clients.length] : undefined;
    const targetProspect = !useClient && prospects.length > 0 ? prospects[i % prospects.length] : undefined;
    const start = isPast ? daysFromNow(-(3 + i * 2)) : daysFromNow(2 + i * 2);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await prisma.appointment.create({
      data: {
        crmId: crm.id,
        title: `${DEMO_PREFIX}RDV ${targetClient?.company ?? targetProspect?.company ?? "(démo)"}`,
        clientId: targetClient?.id,
        prospectId: targetProspect?.id,
        ownerId: owner.id,
        startAt: start,
        endAt: end,
        location: "Sur site",
        status: isPast ? AppointmentStatus.COMPLETED : AppointmentStatus.SCHEDULED,
        notes: "Rendez-vous de démonstration.",
        reportSummary: isPast ? "Échange constructif, besoin confirmé." : null,
        reportNextStep: isPast ? "Envoyer un devis" : null,
      },
    });
    appointmentsCreated++;
    totals.appointmentsCreated++;
  }

  // -- Tâches --------------------------------------------------------
  let tasksCreated = 0;
  const existingTasks = await prisma.task.count({ where: { crmId: crm.id, title: { startsWith: DEMO_PREFIX } } });
  const priorities = [TaskPriority.LOW, TaskPriority.NORMAL, TaskPriority.HIGH, TaskPriority.URGENT];
  for (let i = existingTasks; i < TASKS_PER_CRM; i++) {
    const assignee = crmUsers[i % crmUsers.length]!;
    const createdBy = crmUsers[(i + 1) % crmUsers.length]!;
    const overdue = i % 4 === 0;
    const done = i % 4 === 1;
    const dueAt = overdue ? daysFromNow(-(2 + i)) : daysFromNow(3 + i);
    const targetClient = i % 2 === 0 && clients.length > 0 ? clients[i % clients.length] : undefined;
    await prisma.task.create({
      data: {
        crmId: crm.id,
        title: `${DEMO_PREFIX}Tâche ${i + 1} — ${targetClient?.company ?? "suivi général"}`,
        description: "Tâche de démonstration générée par prisma/seed-demo.ts.",
        assigneeId: assignee.id,
        clientId: targetClient?.id,
        priority: priorities[i % priorities.length]!,
        status: done ? TaskStatus.DONE : overdue ? TaskStatus.TODO : TaskStatus.IN_PROGRESS,
        dueAt,
        createdById: createdBy.id,
        completedAt: done ? daysFromNow(-1) : null,
      },
    });
    tasksCreated++;
    totals.tasksCreated++;
  }

  // -- Devis --------------------------------------------------------
  let quotesCreated = 0;
  const existingQuotes = await prisma.quote.count({ where: { crmId: crm.id, object: { startsWith: DEMO_PREFIX } } });
  const quoteTemplates = [
    { object: "Installation initiale", status: QuoteStatus.SENT },
    { object: "Prestation ponctuelle", status: QuoteStatus.DRAFT },
    { object: "Renouvellement contrat annuel", status: QuoteStatus.ACCEPTED },
  ];
  for (let i = existingQuotes; i < Math.min(QUOTES_PER_CRM, quoteTemplates.length); i++) {
    const template = quoteTemplates[i]!;
    const client = clients[i % Math.max(clients.length, 1)];
    if (!client || !defaultVat) continue;
    const number = await nextQuoteNumber(crm.id);

    const item1Qty = 2 + i;
    const item1Price = 250 + i * 40;
    const item2Qty = 1;
    const item2Price = 600 + i * 25;
    const rate1 = Number(defaultVat.rate);
    const rate2 = Number((reducedVat ?? defaultVat).rate);
    const item1Ht = item1Qty * item1Price;
    const item2Ht = item2Qty * item2Price;
    const totalHt = item1Ht + item2Ht;
    const totalVat = item1Ht * (rate1 / 100) + item2Ht * (rate2 / 100);
    const totalTtc = totalHt + totalVat;

    const issueDate = daysFromNow(-(5 + i * 3));
    const validUntil = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    await prisma.quote.create({
      data: {
        crmId: crm.id,
        number,
        clientId: client.id,
        object: `${DEMO_PREFIX}${template.object}`,
        siretSnapshot: fakeSiret(1000 + i),
        issueDate,
        validUntil,
        status: template.status,
        totalHt,
        totalVat,
        totalTtc,
        createdById: crmUsers[i % crmUsers.length]!.id,
        sentAt: template.status !== QuoteStatus.DRAFT ? issueDate : null,
        acceptedAt: template.status === QuoteStatus.ACCEPTED ? daysFromNow(-(2 + i)) : null,
        items: {
          create: [
            {
              designation: "Prestation principale (démo)",
              quantity: item1Qty,
              unitPriceHt: item1Price,
              vatRateId: defaultVat.id,
              order: 0,
            },
            {
              designation: "Prestation complémentaire (démo)",
              quantity: item2Qty,
              unitPriceHt: item2Price,
              vatRateId: (reducedVat ?? defaultVat).id,
              order: 1,
            },
          ],
        },
      },
    });
    quotesCreated++;
    totals.quotesCreated++;
  }

  console.log(
    `  - ${crm.name} (${crm.slug}) : ${crmClientsCreated} client(s) créé(s), ${crmProspectsCreated} prospect(s) créé(s), ` +
      `${opportunitiesCreated} opportunité(s), ${appointmentsCreated} rendez-vous, ${tasksCreated} tâche(s), ${quotesCreated} devis créés.`
  );
}

async function main() {
  console.log("Génération des données de démonstration CRM Master...\n");

  console.log("Utilisateurs de démonstration :");
  const usersByLocalPart = await ensureDemoUsers();
  console.log(`  ${totals.usersCreated} créé(s), ${totals.usersExisting} déjà existant(s).\n`);

  console.log("Par CRM :");
  const crms = await prisma.crm.findMany({ orderBy: { order: "asc" } });
  for (const crm of crms) {
    await seedCrm(crm.slug, usersByLocalPart);
  }

  console.log("\n============================================================");
  console.log("Résumé global des données de démonstration");
  console.log("============================================================");
  console.log(`Utilisateurs      : ${totals.usersCreated} créé(s) (+ ${totals.usersExisting} déjà présents)`);
  console.log(`Clients           : ${totals.clientsCreated} créé(s) (+ ${totals.clientsExisting} déjà présents)`);
  console.log(`Prospects         : ${totals.prospectsCreated} créé(s) (+ ${totals.prospectsExisting} déjà présents)`);
  console.log(`Opportunités      : ${totals.opportunitiesCreated} créée(s)`);
  console.log(`Rendez-vous       : ${totals.appointmentsCreated} créé(s)`);
  console.log(`Tâches            : ${totals.tasksCreated} créée(s)`);
  console.log(`Devis             : ${totals.quotesCreated} créé(s)`);

  console.log("\n============================================================");
  console.log("Identifiants de connexion (utilisateurs de démonstration)");
  console.log("============================================================");
  console.log(`Mot de passe (identique pour tous) : ${DEMO_PASSWORD}\n`);
  for (const def of DEMO_USERS) {
    const crmList = def.access.map((a) => a.slug).join(", ");
    console.log(`  ${def.firstName} ${def.lastName} <${def.localPart}@${DEMO_EMAIL_DOMAIN}> — accès : ${crmList}`);
  }
  console.log("\nCes utilisateurs et toutes les données préfixées \"[DEMO] \" sont supprimables via : npm run seed:demo:clear\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
