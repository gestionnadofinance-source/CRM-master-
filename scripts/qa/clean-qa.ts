/**
 * Supprime tout ce que la campagne QA a créé dans la base LOCALE :
 * comptes @qa.local, leurs sessions, les chantiers « QA ... » et les
 * pointages, acomptes et absences qui en dépendent.
 *
 * Ne touche à rien d'autre : les espaces, leurs paramètres et les comptes
 * réels sont laissés intacts.
 */
import "dotenv/config";
import { createScriptPrismaClient } from "../../prisma/client";

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@qa.local" } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  // Les chantiers de test emportent en cascade leurs affectations et leurs
  // pointages (voir onDelete: Cascade dans le schéma).
  const chantiers = await prisma.chantier.deleteMany({ where: { name: { startsWith: "QA " } } });
  const acomptes = await prisma.acompte.deleteMany({ where: { userId: { in: userIds } } });
  const absences = await prisma.absence.deleteMany({ where: { userId: { in: userIds } } });
  // Puis les comptes eux-mêmes, qui emportent sessions et accès.
  const deleted = await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(
    `Nettoyé : ${deleted.count} compte(s), ${chantiers.count} chantier(s), ` +
      `${acomptes.count} acompte(s), ${absences.count} absence(s).`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
