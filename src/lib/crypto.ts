import bcrypt from "bcryptjs";
import { randomBytes, randomInt, createHash } from "crypto";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Génère un jeton opaque URL-safe (session, reset password...). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Les jetons opaques (session, reset) ne sont jamais stockés en clair en
 * base : on stocke un hash SHA-256 et on compare le hash du jeton reçu.
 * Contrairement au mot de passe, ces jetons sont déjà aléatoires à haute
 * entropie donc un hash rapide (non bcrypt) suffit et permet une recherche
 * indexée par égalité en base.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateTemporaryPassword(): string {
  const words = ["Boreal", "Cedre", "Ambre", "Solstice", "Zenith", "Ivoire", "Onyx", "Volt"];
  const word = words[randomInt(0, words.length)];
  const suffix = randomInt(1000, 9999);
  const symbols = ["!", "#", "$", "%", "&", "*"];
  const symbol = symbols[randomInt(0, symbols.length)];
  return `${word}${suffix}${symbol}`;
}
