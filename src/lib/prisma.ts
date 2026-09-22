import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Depuis Prisma 7, le client ne lit plus l'URL depuis schema.prisma : la
 * connexion passe par un adaptateur de pilote, ici node-postgres.
 *
 * DATABASE_URL reste la connexion applicative (poolée chez les hébergeurs qui
 * en fournissent une) ; la connexion directe exigée par Migrate est déclarée
 * séparément dans prisma.config.ts et n'a pas cours à l'exécution.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est requis pour se connecter à la base de données.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = global.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
