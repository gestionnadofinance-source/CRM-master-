import "server-only";

// Calcul pur du diff entre les accès CRM existants d'un utilisateur et ceux
// demandés par le formulaire (voir updateUserAccess dans admin/actions.ts) —
// extrait dans ce module séparé pour être testable directement (aucune
// dépendance à requireAuth()/la base : ne fait que comparer deux tableaux).

export interface ExistingAccessRow {
  crmId: string;
  role: string;
  category: string;
  isForeman: boolean;
  // Decimal côté Prisma, comparé via Number() — accepte aussi bien un
  // Decimal réel (production) qu'un number simple (tests).
  defaultHourlyRate: number | { toString(): string };
  defaultHousingAllowance: number | { toString(): string };
  defaultDirtAllowance: number | { toString(): string };
}

export interface DesiredAccessEntry {
  crmId: string;
  role: string;
  category: string;
  isForeman: boolean;
  defaultHourlyRate: number;
  defaultHousingAllowance: number;
  defaultDirtAllowance: number;
}

export interface AccessDiff<TExisting extends ExistingAccessRow, TDesired extends DesiredAccessEntry> {
  toCreate: TDesired[];
  toUpdate: TDesired[];
  toDelete: TExisting[];
}

/**
 * Détermine, pour chaque CRM de la matrice d'accès désirée par le
 * formulaire admin, s'il faut créer, mettre à jour ou (pour ceux retirés)
 * supprimer la ligne UserCrmAccess correspondante — un CRM absent de
 * `existingAccess` est une création, présent dans les deux mais avec au
 * moins un champ différent est une mise à jour, présent uniquement dans
 * `existingAccess` est une suppression.
 */
export function computeAccessDiff<TExisting extends ExistingAccessRow, TDesired extends DesiredAccessEntry>(
  existingAccess: TExisting[],
  desiredAccess: TDesired[]
): AccessDiff<TExisting, TDesired> {
  const desiredByCrm = new Map(desiredAccess.map((a) => [a.crmId, a]));
  const existingByCrm = new Map(existingAccess.map((a) => [a.crmId, a]));

  const toCreate = desiredAccess.filter((a) => !existingByCrm.has(a.crmId));
  const toUpdate = desiredAccess.filter((a) => {
    const existing = existingByCrm.get(a.crmId);
    return (
      !!existing &&
      (existing.role !== a.role ||
        existing.category !== a.category ||
        existing.isForeman !== a.isForeman ||
        Number(existing.defaultHourlyRate) !== a.defaultHourlyRate ||
        Number(existing.defaultHousingAllowance) !== a.defaultHousingAllowance ||
        Number(existing.defaultDirtAllowance) !== a.defaultDirtAllowance)
    );
  });
  const toDelete = existingAccess.filter((a) => !desiredByCrm.has(a.crmId));

  return { toCreate, toUpdate, toDelete };
}
