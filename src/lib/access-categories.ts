import type { AccessCategory } from "@prisma/client";

/**
 * Catégories d'« exploitation transverse » : SECRETAIRE et COMPTABLE.
 *
 * Les deux ont exactement les mêmes droits — seul l'intitulé de la fonction
 * change, pour distinguer les personnes dans la liste des utilisateurs.
 * C'est le SEUL endroit du code où cette équivalence est écrite : partout
 * ailleurs on appelle cette fonction, jamais `category === "SECRETAIRE"`.
 * Ajouter une catégorie équivalente se fait donc ici, et nulle part
 * ailleurs — sans quoi un contrôle oublié ouvrirait ou fermerait une page
 * au hasard.
 *
 * Ce module vit dans `src/lib` et NON dans `src/server/permissions.ts` :
 * la barre de navigation est un composant client, et un module marqué
 * `server-only` n'y est pas importable. Les comparaisons se font sur des
 * chaînes littérales, et `AccessCategory` n'est importé qu'en type (donc
 * effacé à la compilation) : rien du client Prisma n'atteint le navigateur.
 */
export function isTransverseCategory(category: AccessCategory): boolean {
  return category === "SECRETAIRE" || category === "COMPTABLE";
}

/**
 * Intitulé affiché d'une catégorie d'accès. Vit ici, avec
 * isTransverseCategory, pour qu'ajouter une catégorie n'oblige pas à courir
 * après les écrans : le coffre-fort affichait encore « Commercial » pour
 * toute catégorie autre qu'OUVRIER, alors que ce profil avait été supprimé.
 */
export const ACCESS_CATEGORY_LABELS: Record<AccessCategory, string> = {
  OUVRIER: "Ouvrier",
  SECRETAIRE: "Secrétaire",
  COMPTABLE: "Comptable",
};
