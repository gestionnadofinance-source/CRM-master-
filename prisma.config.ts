import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Configuration Prisma (introduite par Prisma 7).
 *
 * Les URL de connexion ne peuvent plus figurer dans schema.prisma : elles sont
 * déclarées ici pour Migrate, et fournies au client d'exécution par un
 * adaptateur de pilote (voir src/lib/prisma.ts).
 *
 * `directUrl` reste la connexion NON poolée exigée par Migrate : les poolers en
 * mode transaction (PgBouncer, pooler Neon) ne supportent pas les verrous
 * consultatifs qu'il utilise pour éviter les migrations concurrentes. Le repli
 * sur DATABASE_URL couvre les hébergeurs sans pooler, où la connexion est déjà
 * directe — voir scripts/vercel-migrate.sh, qui alimente DIRECT_URL depuis les
 * noms propres aux intégrations gérées avant d'appeler Migrate.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // URL utilisée par Migrate uniquement. C'est la connexion DIRECTE (non
    // poolée) : les poolers en mode transaction (PgBouncer, pooler Neon) ne
    // supportent pas les verrous consultatifs que Migrate pose pour éviter les
    // migrations concurrentes. Le repli sur DATABASE_URL couvre les hébergeurs
    // sans pooler, où la connexion est déjà directe.
    //
    // L'application, elle, ne passe pas par ici : elle se connecte via
    // l'adaptateur de pilote avec DATABASE_URL (voir src/lib/prisma.ts).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
