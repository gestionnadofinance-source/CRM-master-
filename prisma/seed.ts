/**
 * Initialisation minimale de CRM Master : les 5 CRM prévus par le cahier
 * des charges, leur configuration de base (pipeline, sources, TVA,
 * réservation), et le premier administrateur global.
 *
 * Usage : npm run seed
 * Variables optionnelles : ADMIN_EMAIL, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_PASSWORD
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Lit une variable d'environnement optionnelle en traitant une valeur vide
 * comme une absence.
 *
 * `process.env.X ?? défaut` ne se replie que sur `undefined`. Or un tableau de
 * bord d'hébergeur (Vercel, Railway...) enregistre une variable déclarée mais
 * laissée vide comme une chaîne vide, qui traverse `??` sans déclencher le
 * défaut. Un ADMIN_EMAIL vide créait ainsi l'administrateur global avec une
 * adresse vide : compte impossible à utiliser, aucun message d'erreur, et que
 * le seed ne corrige jamais de lui-même puisqu'il ne recrée pas un
 * administrateur quand il en existe déjà un (voir plus bas). Même logique que
 * normalizeEnv() dans src/lib/env.ts, réimplémentée ici pour garder ce script
 * sans dépendance au code applicatif.
 */
function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/**
 * Toutes les autres portes d'entrée normalisent l'email avant de lire ou
 * d'écrire un compte — connexion (src/server/auth/actions.ts), création
 * d'utilisateur (src/server/admin/actions.ts, src/server/crm-users/actions.ts).
 * Sans cette normalisation ici, un ADMIN_EMAIL saisi avec des majuscules
 * créerait un compte que la connexion, elle, ne retrouverait jamais.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const DEFAULT_STAGES = [
  { name: "Nouveau prospect", order: 0, color: "#94a3b8" },
  { name: "Contact établi", order: 1, color: "#60a5fa" },
  { name: "Rendez-vous", order: 2, color: "#38bdf8" },
  { name: "Devis", order: 3, color: "#a78bfa" },
  { name: "Négociation", order: 4, color: "#fbbf24" },
  { name: "Gagné", order: 5, color: "#34d399", isWon: true },
  { name: "Perdu", order: 6, color: "#f87171", isLost: true },
];

const DEFAULT_SOURCES = [
  "Site internet",
  "Téléphone",
  "Email",
  "Prospection",
  "Recommandation",
  "Réseaux sociaux",
  "Publicité",
  "Salon",
  "Ancien client",
  "Autre",
];

const DEFAULT_VAT_RATES = [
  { label: "20% (taux normal)", rate: 20, isDefault: true },
  { label: "10% (taux intermédiaire)", rate: 10, isDefault: false },
  { label: "5,5% (taux réduit)", rate: 5.5, isDefault: false },
  { label: "0% (exonéré)", rate: 0, isDefault: false },
];

const CRMS: { name: string; slug: string; color: string; prefix: string; description: string }[] = [
  { name: "Fidem Froid Clim", slug: "fidem-froid-clim", color: "#2563eb", prefix: "FFC", description: "Installation et dépannage froid & climatisation" },
  { name: "Fidem Maintenance", slug: "fidem-maintenance", color: "#0891b2", prefix: "FM", description: "Contrats de maintenance technique" },
  { name: "Fitness Park Modge", slug: "fitness-park-modge", color: "#dc2626", prefix: "FPM", description: "Club de sport" },
  { name: "Association", slug: "association", color: "#7c3aed", prefix: "ASSO", description: "Gestion associative" },
  { name: "Société de Communication", slug: "societe-communication", color: "#d97706", prefix: "COM", description: "Agence de communication" },
];

async function main() {
  console.log("Initialisation de CRM Master...");

  for (const [index, crmDef] of CRMS.entries()) {
    const crm = await prisma.crm.upsert({
      where: { slug: crmDef.slug },
      update: {},
      create: {
        name: crmDef.name,
        slug: crmDef.slug,
        color: crmDef.color,
        description: crmDef.description,
        order: index,
      },
    });

    await prisma.companySettings.upsert({
      where: { crmId: crm.id },
      update: {},
      create: { crmId: crm.id, legalName: crmDef.name },
    });

    await prisma.bookingSettings.upsert({
      where: { crmId: crm.id },
      update: {},
      create: { crmId: crm.id, publicSlug: crmDef.slug },
    });

    for (const stage of DEFAULT_STAGES) {
      const existing = await prisma.pipelineStage.findFirst({ where: { crmId: crm.id, name: stage.name } });
      if (!existing) {
        await prisma.pipelineStage.create({ data: { crmId: crm.id, ...stage } });
      }
    }

    for (const [order, name] of DEFAULT_SOURCES.entries()) {
      await prisma.source.upsert({
        where: { crmId_name: { crmId: crm.id, name } },
        update: {},
        create: { crmId: crm.id, name, order },
      });
    }

    for (const vat of DEFAULT_VAT_RATES) {
      await prisma.vatRate.upsert({
        where: { crmId_label: { crmId: crm.id, label: vat.label } },
        update: {},
        create: { crmId: crm.id, label: vat.label, rate: vat.rate, isDefault: vat.isDefault },
      });
    }

    await prisma.quoteCounter.upsert({
      where: { crmId_prefix_year: { crmId: crm.id, prefix: crmDef.prefix, year: new Date().getFullYear() } },
      update: {},
      create: { crmId: crm.id, prefix: crmDef.prefix, year: new Date().getFullYear(), lastNumber: 0 },
    });

    console.log(`  ✓ CRM prêt : ${crmDef.name}`);
  }

  const adminEmail = normalizeEmail(envOrDefault("ADMIN_EMAIL", "admin@crm-master.local"));
  const adminFirstName = envOrDefault("ADMIN_FIRST_NAME", "Super");
  const adminLastName = envOrDefault("ADMIN_LAST_NAME", "Admin");
  const adminPassword = envOrDefault("ADMIN_PASSWORD", "ChangeMoi123!");

  // Cherche un admin existant par email OU par le simple fait qu'un
  // administrateur global existe déjà (ex. après un renommage d'email) —
  // sans ce second cas, ré-exécuter le seed après un renommage recréerait
  // un doublon sous l'ancienne adresse par défaut.
  const existingAdmin =
    (await prisma.user.findUnique({ where: { email: adminEmail } })) ??
    (await prisma.user.findFirst({ where: { isGlobalAdmin: true } }));
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        firstName: adminFirstName,
        lastName: adminLastName,
        passwordHash,
        isGlobalAdmin: true,
        mustChangePassword: true,
        color: "#1d3cd6",
      },
    });
    console.log("\n✓ Administrateur global créé :");
    console.log(`  Email : ${adminEmail}`);
    console.log(`  Mot de passe temporaire : ${adminPassword}`);
    console.log("  (changement de mot de passe obligatoire à la première connexion)\n");
  } else {
    console.log(`\nAdministrateur global déjà existant (${existingAdmin.email}), inchangé.\n`);
  }

  console.log("Initialisation terminée.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
