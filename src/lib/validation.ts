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

/**
 * Bornes de longueur des champs texte. Tout champ libre accepté par une
 * server action doit en porter une : sans borne haute, un appelant peut
 * stocker des mégaoctets par requête (l'API publique d'écriture accepte
 * du JSON arbitraire), gonfler la base et alourdir chaque lecture qui
 * remonte la colonne.
 *
 * Les valeurs sont volontairement larges — très au-dessus de toute saisie
 * réaliste — pour qu'aucune fiche existante ne devienne non modifiable :
 * la règle s'applique aussi aux mises à jour, donc une borne trop basse
 * bloquerait l'édition de données déjà enregistrées.
 */
export const MAX_ID = 64; // cuid/uuid : 25 à 36 caractères
export const MAX_CODE = 40; // code court : couleur, SIRET, APE, date ISO, heure
export const MAX_SHORT = 200; // libellé d'une ligne : nom, titre, email
export const MAX_TEXT = 2_000; // paragraphe ou URL
export const MAX_LONG = 20_000; // texte libre long : notes, mentions légales

export const tooLong = (limit: number) => `Ce champ ne peut pas dépasser ${limit} caractères.`;

/**
 * Caractères de contrôle interdits dans les champs texte.
 *
 * PostgreSQL refuse l'octet nul dans une colonne `text` (SQLSTATE 22021) :
 * sans contrôle en amont, la valeur traversait la validation et faisait
 * échouer la requête en base — une saisie invalide rendue en erreur
 * serveur, là où c'est l'appelant qui est en faute. On écarte donc l'octet
 * nul et les autres caractères de contrôle, en laissant passer tabulation,
 * retour chariot et saut de ligne, légitimes dans les champs multilignes
 * (notes, mentions légales, conditions...).
 *
 * `.regex()` plutôt que `.refine()` : la première reste un `ZodString` et
 * laisse la chaîne se poursuivre (`.email()`, `.nullable()`...), la seconde
 * renvoie un `ZodEffects` qui la briserait.
 */
export const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/;
export const CONTROL_CHARS_MESSAGE = "Ce champ contient des caractères non autorisés.";

/**
 * Bornes des champs numériques, calées sur la précision des colonnes
 * `Decimal` correspondantes (cf. prisma/schema.prisma). Au-delà, PostgreSQL
 * lève « numeric field overflow » : autant refuser proprement en amont.
 */
export const MAX_DECIMAL_10_2 = 99_999_999.99; // @db.Decimal(10, 2) — quantité d'une ligne de devis
export const MAX_DECIMAL_12_2 = 9_999_999_999.99; // @db.Decimal(12, 2) — montants et totaux
export const MAX_INT4 = 2_147_483_647; // entier PostgreSQL

export const outOfRange = (limit: number) =>
  `Cette valeur dépasse le maximum autorisé (${limit.toLocaleString("fr-FR")}).`;
