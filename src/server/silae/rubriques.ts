import "server-only";

/**
 * Catalogue des rubriques exportables vers Silae.
 *
 * Source unique : cette liste alimente à la fois les valeurs par défaut de
 * la table de correspondance (écran de paramétrage) et l'agrégation
 * mensuelle. Ajouter une rubrique ici suffit à la faire apparaître dans les
 * deux.
 *
 * `defaultCode` n'est qu'une PROPOSITION, à faire valider par le
 * gestionnaire de paie : les codes doivent être strictement identiques aux
 * intitulés de colonne de Silae (Paramétrage > Variables à saisir), casse
 * comprise. Un code faux ne provoque aucune erreur à l'import — la valeur
 * est ignorée sans prévenir. D'où le rapport de contrôle, qui signale toute
 * rubrique porteuse d'une valeur sans code paramétré.
 */
export type RubriqueUnit = "heures" | "montant" | "nombre";

export interface RubriqueDefinition {
  key: string;
  label: string;
  unit: RubriqueUnit;
  defaultCode: string;
  /** false : présente dans le paramétrage, mais non exportée par défaut. */
  defaultExported: boolean;
  /** Précision affichée à l'écran de paramétrage. */
  note?: string;
}

export const RUBRIQUES: RubriqueDefinition[] = [
  // --- Heures ---------------------------------------------------------
  {
    key: "heuresTravaillees",
    label: "Heures travaillées",
    unit: "heures",
    defaultCode: "",
    defaultExported: false,
    note: "Non exportées par défaut : Silae calcule la base depuis le contrat. À activer seulement si votre gestionnaire le demande.",
  },
  { key: "hs25", label: "Heures supplémentaires 25 %", unit: "heures", defaultCode: "HS25", defaultExported: true,
    note: "Calculées par semaine : au-delà de 35 h, les 8 premières heures. Nombre d'heures brut — Silae applique la majoration." },
  { key: "hs50", label: "Heures supplémentaires 50 %", unit: "heures", defaultCode: "HS50", defaultExported: true,
    note: "Heures au-delà des 8 premières heures supplémentaires de la semaine." },
  { key: "heuresNuit", label: "Heures de nuit", unit: "heures", defaultCode: "EV-Hnuit", defaultExported: true },
  { key: "heuresDimanche", label: "Heures du dimanche", unit: "heures", defaultCode: "EV-Hdim", defaultExported: true,
    note: "Déduites de la date : toute heure saisie un dimanche." },
  { key: "heuresFerie", label: "Heures de jour férié travaillé", unit: "heures", defaultCode: "EV-Hferie", defaultExported: true,
    note: "Calendrier des fériés français calculé automatiquement, Pâques comprise." },

  // --- Frais et indemnités (montants) ---------------------------------
  { key: "indemniteKm", label: "Indemnité kilométrique", unit: "montant", defaultCode: "EV-IndKm", defaultExported: true },
  { key: "fraisSncf", label: "Frais SNCF", unit: "montant", defaultCode: "EV-FraisSNCF", defaultExported: true },
  { key: "indemniteTrajet", label: "Indemnité de trajet", unit: "montant", defaultCode: "EV-Voyage", defaultExported: true,
    note: "Calculée par le CRM mais absente du classeur Excel : elle était perdue jusqu'ici." },
  { key: "remboursementTrajet", label: "Remboursement du temps de trajet", unit: "montant", defaultCode: "", defaultExported: true,
    note: "Heures de trajet × taux horaire de trajet, par jour travaillé. Calculé par le CRM mais absent du classeur Excel. Code à obtenir auprès du gestionnaire." },
  { key: "logement", label: "Indemnité de logement", unit: "montant", defaultCode: "EV-Logement", defaultExported: true },
  { key: "retenueChambre", label: "Retenue de chambre", unit: "montant", defaultCode: "EV-RetenueChambre", defaultExported: true,
    note: "Signe à confirmer avec le gestionnaire de paie : montant positif ou négatif selon le paramétrage de la rubrique dans Silae." },

  // --- Primes (montants) ----------------------------------------------
  { key: "primeManagement", label: "Prime de management", unit: "montant", defaultCode: "EV-PrimeManagement", defaultExported: true },
  { key: "primeHabillage", label: "Prime d'habillage", unit: "montant", defaultCode: "EV-PrimeHabillage", defaultExported: true },
  { key: "primePoste", label: "Prime de poste", unit: "montant", defaultCode: "EV-PrimePoste", defaultExported: true },
  { key: "primeMasque", label: "Prime de masque", unit: "montant", defaultCode: "EV-Masque", defaultExported: true },
  { key: "primeZone", label: "Prime de zone", unit: "montant", defaultCode: "EV-Zone", defaultExported: true },
  { key: "primeSalissure", label: "Prime de salissure", unit: "montant", defaultCode: "", defaultExported: true,
    note: "Calculée par le CRM mais absente du classeur Excel : elle était perdue jusqu'ici. Code à obtenir auprès du gestionnaire." },

  // --- Repas et déplacements (nombres) --------------------------------
  { key: "repasMidi", label: "Repas midi", unit: "nombre", defaultCode: "EV-RepasMidi", defaultExported: true,
    note: "Nombre de repas, pas un montant. Utiliser le multiplicateur si Silae attend un montant." },
  { key: "repasSoir", label: "Repas soir", unit: "nombre", defaultCode: "EV-RepasSoir", defaultExported: true },
  { key: "panier", label: "Panier repas", unit: "nombre", defaultCode: "EV-Panier", defaultExported: true },
  { key: "grandDeplacement53", label: "Grand déplacement (barème 53)", unit: "nombre", defaultCode: "EV-GdDepl53", defaultExported: true },
  { key: "grandDeplacement80", label: "Grand déplacement (barème 80)", unit: "nombre", defaultCode: "EV-GdDepl80", defaultExported: true },

  // --- Autres ----------------------------------------------------------
  { key: "acompte", label: "Acompte", unit: "montant", defaultCode: "EV-Acompte", defaultExported: true },
];

export const RUBRIQUE_BY_KEY = new Map(RUBRIQUES.map((r) => [r.key, r]));
