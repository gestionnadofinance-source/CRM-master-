import { z } from "zod";

/**
 * Règle de mot de passe partagée entre les server actions d'auth
 * (changement par l'utilisateur) et d'administration (mot de passe défini
 * ou régénéré par un admin). Vit hors d'un fichier "use server" car ceux-ci
 * ne peuvent exporter que des fonctions async.
 */
export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .regex(/[a-z]/, "Le mot de passe doit contenir une minuscule.")
  .regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule.")
  .regex(/[0-9]/, "Le mot de passe doit contenir un chiffre.");
