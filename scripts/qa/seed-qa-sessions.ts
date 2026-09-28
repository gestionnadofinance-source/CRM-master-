/**
 * Comptes et sessions de test pour la campagne QA (environnement LOCAL).
 *
 * Crée un utilisateur par profil à tester et une session valide pour chacun,
 * puis imprime les jetons : les scénarios d'accès peuvent alors être rejoués
 * avec un simple cookie, sans automatiser l'écran de connexion.
 *
 * Idempotent et réversible : tous les comptes portent le suffixe
 * @qa.local et sont supprimés par scripts/qa/clean-qa-sessions.ts.
 *
 * À N'EXÉCUTER QUE sur la base locale : le script crée des utilisateurs
 * actifs avec des sessions ouvertes.
 */
import "dotenv/config";
import { createScriptPrismaClient } from "../../prisma/client";
import { hashPassword, generateToken, hashToken } from "../../src/lib/crypto";
import type { AccessCategory } from "@prisma/client";

const PROFILES: Array<{ email: string; firstName: string; lastName: string; isGlobalAdmin: boolean; category?: AccessCategory; isForeman?: boolean }> = [
  { email: "qa.admin@qa.local", firstName: "QA", lastName: "Admin", isGlobalAdmin: true },
  { email: "qa.secretaire@qa.local", firstName: "QA", lastName: "Secretaire", isGlobalAdmin: false, category: "SECRETAIRE" },
  { email: "qa.comptable@qa.local", firstName: "QA", lastName: "Comptable", isGlobalAdmin: false, category: "COMPTABLE" },
  { email: "qa.ouvrier@qa.local", firstName: "QA", lastName: "Ouvrier", isGlobalAdmin: false, category: "OUVRIER" },
  { email: "qa.chef@qa.local", firstName: "QA", lastName: "Chef", isGlobalAdmin: false, category: "OUVRIER", isForeman: true },
];

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();
  const crms = await prisma.crm.findMany({ orderBy: { order: "asc" } });
  if (crms.length === 0) throw new Error("Aucun CRM en base : rien à rattacher.");

  const passwordHash = await hashPassword("QaTest1234!");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const out: Array<{ profil: string; email: string; token: string }> = [];

  for (const p of PROFILES) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { status: "ACTIVE", mustChangePassword: false, isGlobalAdmin: p.isGlobalAdmin },
      create: {
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        passwordHash,
        mustChangePassword: false,
        isGlobalAdmin: p.isGlobalAdmin,
      },
    });

    // Un administrateur global n'a pas de ligne UserCrmAccess (voir
    // GLOBAL_ADMIN_ACCESS dans src/server/tenant.ts).
    if (p.category) {
      for (const crm of crms) {
        await prisma.userCrmAccess.upsert({
          where: { userId_crmId: { userId: user.id, crmId: crm.id } },
          update: { category: p.category, isForeman: p.isForeman ?? false },
          create: { userId: user.id, crmId: crm.id, category: p.category, isForeman: p.isForeman ?? false },
        });
      }
    }

    const token = generateToken();
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
    out.push({ profil: `${p.category ?? "ADMIN GLOBAL"}${p.isForeman ? " (chef de chantier)" : ""}`, email: p.email, token });
  }

  console.log(JSON.stringify({ crms: crms.map((c) => c.slug), sessions: out }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
