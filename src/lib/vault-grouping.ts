/**
 * Regroupement des documents du coffre-fort personnel.
 *
 * Les fiches de pointage, ordres de mission et pointages client sont déposés
 * automatiquement par l'application, par dizaines, dans des dossiers créés à la
 * volée (un par semaine et par chantier). Les chercher dans une arborescence
 * n'avait plus de sens : ces trois natures de document ont chacune leur onglet,
 * regroupé sur la donnée qui compte — le mois couvert pour les pointages, le
 * chantier pour les ordres de mission (voir VaultDocument.periodStart et
 * .chantierId dans prisma/schema.prisma). Le reste — fiches de paie, documents
 * déposés à la main — garde l'arborescence libre.
 *
 * Module volontairement pur et sans dépendance (ni Prisma, ni React) : la
 * logique de classement est ainsi testable seule, voir tests/vault-grouping.test.ts.
 * Les types sont structurels plutôt qu'importés de Prisma, pour que ce module
 * n'impose rien de plus que ce qu'il lit réellement.
 */

/** Catégories présentées dans un onglet dédié, donc exclues de l'arborescence libre. */
export const AUTO_CATEGORIES = ["TIMESHEET_EMPLOYEE", "MISSION_ORDER", "TIMESHEET_CLIENT"] as const;

export function isAutoCategory(category: string): boolean {
  return (AUTO_CATEGORIES as readonly string[]).includes(category);
}

export interface GroupableDocument {
  id: string;
  category: string;
  folderId: string | null;
  createdAt: Date | string;
  periodStart: Date | string | null;
  chantier: { id: string; name: string } | null;
}

export interface GroupableFolder {
  id: string;
  parentId: string | null;
}

export interface DocumentGroup<T> {
  key: string;
  label: string;
  docs: T[];
}

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/** Clé de tri année-mois : se compare comme une chaîne, du plus récent au plus ancien. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Regroupe par mois couvert.
 *
 * `periodStart` est la semaine concernée par la fiche, et non sa date de dépôt :
 * une fiche de la semaine du 3 mars déposée le 2 avril se classe en mars.
 * `createdAt` ne sert que de repli pour les documents antérieurs à
 * l'enregistrement de cette donnée.
 */
export function groupByMonth<T extends GroupableDocument>(docs: T[]): DocumentGroup<T>[] {
  const groups = new Map<string, DocumentGroup<T>>();
  for (const doc of docs) {
    const date = new Date(doc.periodStart ?? doc.createdAt);
    const key = monthKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: MONTH_LABEL.format(date), docs: [] };
      groups.set(key, group);
    }
    group.docs.push(doc);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** Clé du groupe « chantier absent » — documents antérieurs à l'enregistrement du chantier. */
const NO_CHANTIER = "__none__";

/** Regroupe par chantier, par ordre alphabétique ; le groupe sans chantier ferme la liste. */
export function groupByChantier<T extends GroupableDocument>(docs: T[]): DocumentGroup<T>[] {
  const groups = new Map<string, DocumentGroup<T>>();
  for (const doc of docs) {
    const key = doc.chantier?.id ?? NO_CHANTIER;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: doc.chantier?.name ?? "Chantier non renseigné", docs: [] };
      groups.set(key, group);
    }
    group.docs.push(doc);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_CHANTIER) return 1;
    if (b.key === NO_CHANTIER) return -1;
    return a.label.localeCompare(b.label, "fr");
  });
}

/**
 * Dossiers à montrer dans l'onglet « Mes documents ».
 *
 * Un dossier dont tout le contenu est du déposé automatique — une semaine de
 * pointage, les ordres de mission — est masqué : ses documents sont déjà
 * classés par les onglets dédiés, et il n'apparaîtrait ici que vide. Un dossier
 * vide est au contraire conservé : c'est typiquement celui que le propriétaire
 * vient de créer pour y ranger quelque chose.
 */
export function foldersForFreeTree<F extends GroupableFolder>(
  folders: F[],
  documents: GroupableDocument[]
): F[] {
  const childrenOf = new Map<string | null, F[]>();
  for (const folder of folders) {
    const siblings = childrenOf.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenOf.set(folder.parentId, siblings);
  }

  const ownCounts = new Map<string | null, { total: number; free: number }>();
  for (const doc of documents) {
    const counts = ownCounts.get(doc.folderId) ?? { total: 0, free: 0 };
    counts.total += 1;
    if (!isAutoCategory(doc.category)) counts.free += 1;
    ownCounts.set(doc.folderId, counts);
  }

  const hidden = new Set<string>();
  /** Cumule les compteurs du sous-arbre et masque au passage les dossiers purement automatiques. */
  function visit(folder: F): { total: number; free: number } {
    const own = ownCounts.get(folder.id) ?? { total: 0, free: 0 };
    let total = own.total;
    let free = own.free;
    for (const child of childrenOf.get(folder.id) ?? []) {
      const sub = visit(child);
      total += sub.total;
      free += sub.free;
    }
    if (total > 0 && free === 0) hidden.add(folder.id);
    return { total, free };
  }
  for (const root of childrenOf.get(null) ?? []) visit(root);

  return folders.filter((folder) => !hidden.has(folder.id));
}
