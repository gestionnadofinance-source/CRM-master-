/**
 * Supprime toutes les données de démonstration créées par
 * `prisma/seed-demo.ts`, identifiées uniquement par :
 *
 *   - le préfixe "[DEMO] " sur Client.company / Prospect.company /
 *     Opportunity.title / Appointment.title / Task.title / Quote.object ;
 *   - le domaine d'email "@demo.crm-master.local" pour les utilisateurs.
 *
 * Ne touche JAMAIS aux 5 CRM réels (Fidem Froid Clim, Fidem Maintenance,
 * Fitness Park Modge, Association, Société de Communication), à l'admin
 * global, ni à aucune donnée qui ne correspond pas exactement à ces
 * conventions. Sûr à relancer plusieurs fois de suite (no-op si déjà
 * propre).
 *
 * Usage : npm run seed:demo:clear
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_EMAIL_DOMAIN = "demo.crm-master.local";
const DEMO_PREFIX = "[DEMO] ";

async function main() {
  console.log("Suppression des données de démonstration CRM Master...\n");

  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true, email: true },
  });
  const demoUserIds = demoUsers.map((u) => u.id);

  // Les entités métier identifiées par préfixe "[DEMO] " ne sont
  // supprimées explicitement d'abord que lorsqu'elles n'ont pas de
  // relation onDelete: Cascade fiable depuis Client/Prospect (ex :
  // Opportunity.client / Appointment.client / Task.client n'ont pas de
  // cascade — seul le Client/Prospect lui-même cascade depuis Crm). On
  // supprime donc dans l'ordre le plus dépendant → le moins dépendant pour
  // ne jamais dépendre d'un ordre de cascade ambigu.

  const quotes = await prisma.quote.findMany({
    where: { object: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const quoteIds = quotes.map((q) => q.id);
  // QuoteItem/QuoteVersion/Document cascadent depuis Quote (onDelete:
  // Cascade), donc un simple deleteMany sur Quote suffit pour eux.
  // Task.quoteId, lui, n'a PAS de cascade (relation Restrict par défaut) :
  // on le détache avant, sinon la suppression du devis échoue sur cette FK.
  if (quoteIds.length > 0) {
    await prisma.task.updateMany({ where: { quoteId: { in: quoteIds } }, data: { quoteId: null } });
  }
  const deletedQuotes = await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });

  const deletedTasks = await prisma.task.deleteMany({ where: { title: { startsWith: DEMO_PREFIX } } });

  const appointments = await prisma.appointment.findMany({
    where: { title: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const appointmentIds = appointments.map((a) => a.id);
  if (appointmentIds.length > 0) {
    // Task.appointmentId n'a pas de cascade ; AppointmentParticipant si
    // (onDelete: Cascade via appointment).
    await prisma.task.updateMany({ where: { appointmentId: { in: appointmentIds } }, data: { appointmentId: null } });
  }
  const deletedAppointments = await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });

  const deletedOpportunities = await prisma.opportunity.deleteMany({
    where: { title: { startsWith: DEMO_PREFIX } },
  });

  const deletedProspects = await prisma.prospect.deleteMany({ where: { company: { startsWith: DEMO_PREFIX } } });
  const deletedClients = await prisma.client.deleteMany({ where: { company: { startsWith: DEMO_PREFIX } } });

  // UserCrmAccess / Session cascadent depuis User (onDelete: Cascade). Les
  // entités métier ci-dessus référencent
  // ownerId/assigneeId/createdById/uploadedById SANS cascade depuis User,
  // mais elles ont déjà été supprimées ci-dessus (ou n'existent jamais pour
  // un utilisateur démo en dehors de données préfixées "[DEMO] "), donc
  // supprimer les utilisateurs démo maintenant est sûr.
  const deletedUsers = demoUserIds.length > 0 ? await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } }) : { count: 0 };

  console.log("Résumé de la suppression :");
  console.log(`  Devis (+ lignes)   : ${deletedQuotes.count}`);
  console.log(`  Tâches             : ${deletedTasks.count}`);
  console.log(`  Rendez-vous        : ${deletedAppointments.count}`);
  console.log(`  Opportunités       : ${deletedOpportunities.count}`);
  console.log(`  Prospects          : ${deletedProspects.count}`);
  console.log(`  Clients            : ${deletedClients.count}`);
  console.log(`  Utilisateurs démo  : ${deletedUsers.count}`);
  console.log("\nDonnées de démonstration supprimées. Les 5 CRM réels, l'administrateur global et toute donnée non préfixée \"[DEMO] \" restent inchangés.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
