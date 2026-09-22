import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Client Prisma pour les scripts hors application (seed, données de
 * démonstration, purge).
 *
 * Depuis Prisma 7, le client ne lit plus l'URL depuis schema.prisma : la
 * connexion passe obligatoirement par un adaptateur de pilote. Ces scripts
 * partagent donc cette fabrique plutôt que de répéter — et d'oublier — la
 * construction de l'adaptateur. Volontairement séparé de src/lib/prisma.ts,
 * qui gère en plus la mise en cache du client entre rechargements à chaud et
 * n'a pas vocation à être importé par un script exécuté via tsx.
 */
export function createScriptPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est requis pour se connecter à la base de données.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
