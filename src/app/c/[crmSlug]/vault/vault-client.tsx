"use client";

import { useState, useEffect, useTransition } from "react";
import { FileText, Download, Trash2, Upload, Lock, ChevronLeft, ChevronRight, Folder, FolderPlus, Pencil, X, FileSpreadsheet, Move } from "lucide-react";
import {
  listMyVaultDocuments,
  listMyVaultFolders,
  listVaultDocumentsForUser,
  listVaultFoldersForUser,
  uploadVaultDocument,
  deleteVaultDocument,
  createVaultFolder,
  createMyVaultFolder,
  renameVaultFolder,
  deleteVaultFolder,
  moveVaultDocument,
  moveVaultFolder,
  listVaultMembers,
} from "@/server/vault/actions";
import { generateAccountingExport } from "@/server/accounting/actions";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { cn, formatDate, initials } from "@/lib/utils";

type Document = Awaited<ReturnType<typeof listMyVaultDocuments>>[number];
type FolderNode = Awaited<ReturnType<typeof listMyVaultFolders>>[number];
type Member = Awaited<ReturnType<typeof listVaultMembers>>[number];

// La sélection multi-fiches pour "Transformer en tableau de comptabilité"
// (voir AdminVaultPanel) ne doit JAMAIS se perdre tant qu'elle n'a pas
// abouti à un export — y compris si la page se recharge entièrement
// (bouton précédent du navigateur, onglet déchargé en arrière-plan sur
// mobile, actualisation accidentelle...), pas seulement en naviguant entre
// dossiers dans la même page. sessionStorage survit à un rechargement,
// jamais à la fermeture de l'onglet — c'est le comportement voulu, une
// sélection en cours n'a pas de sens dans un nouvel onglet.
function vaultSelectionKey(crmId: string, employeeId: string): string {
  return `cmk_vault_selection:${crmId}:${employeeId}`;
}
function loadPersistedSelection(crmId: string, employeeId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(vaultSelectionKey(crmId, employeeId));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}
function savePersistedSelection(crmId: string, employeeId: string, ids: Set<string>): void {
  try {
    if (ids.size === 0) sessionStorage.removeItem(vaultSelectionKey(crmId, employeeId));
    else sessionStorage.setItem(vaultSelectionKey(crmId, employeeId), JSON.stringify(Array.from(ids)));
  } catch {
    // Stockage indisponible (navigation privée, quota...) : la sélection reste correcte en mémoire pour la session en cours.
  }
}

/** Quel salarié/dossier était ouvert — pour rouvrir au même endroit après un rechargement complet de la page. */
function vaultActiveKey(crmId: string): string {
  return `cmk_vault_active:${crmId}`;
}
function loadPersistedActive(crmId: string): { employeeId: string; folderId: string | null } | null {
  try {
    const raw = sessionStorage.getItem(vaultActiveKey(crmId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function savePersistedActive(crmId: string, value: { employeeId: string; folderId: string | null } | null): void {
  try {
    if (!value) sessionStorage.removeItem(vaultActiveKey(crmId));
    else sessionStorage.setItem(vaultActiveKey(crmId), JSON.stringify(value));
  } catch {
    // idem
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const CATEGORY_LABELS: Record<string, string> = {
  PAYSLIP: "Fiche de paie",
  DOCUMENT: "Document",
  TIMESHEET_EMPLOYEE: "Pointage salarié",
  TIMESHEET_CLIENT: "Pointage client",
  MISSION_ORDER: "Ordre de mission",
  ACCOUNTING_EXPORT: "Tableau de comptabilité",
};
const CATEGORY_VARIANTS: Record<string, "brand" | "default" | "warning"> = {
  PAYSLIP: "brand",
  DOCUMENT: "default",
  TIMESHEET_EMPLOYEE: "warning",
  TIMESHEET_CLIENT: "warning",
  MISSION_ORDER: "brand",
  ACCOUNTING_EXPORT: "brand",
};

function DocumentRow({
  doc,
  canDelete,
  crmId,
  onChanged,
  selectable,
  selected,
  onToggleSelect,
  onMove,
}: {
  doc: Document;
  canDelete: boolean;
  crmId: string;
  onChanged?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onMove?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {selectable && (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={!!selected}
          onChange={() => onToggleSelect?.(doc.id)}
          aria-label={`Sélectionner ${doc.fileName}`}
        />
      )}
      <FileText className="h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm text-text">{doc.fileName}</p>
          <Badge variant={CATEGORY_VARIANTS[doc.category] ?? "default"}>{CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
        </div>
        <p className="text-[11px] text-muted">
          {formatSize(doc.size)} · déposé par {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} le{" "}
          {formatDate(doc.createdAt, true)}
        </p>
      </div>
      <a href={`/api/vault/${doc.id}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">
        <Download className="h-4 w-4" />
      </a>
      {onMove && (
        <button onClick={onMove} className="text-muted hover:text-brand" title="Déplacer">
          <Move className="h-4 w-4" />
        </button>
      )}
      {canDelete && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await deleteVaultDocument(crmId, doc.id);
              onChanged?.();
            })
          }
          className="text-muted hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/** Arborescence de dossiers + documents du dossier courant. Lecture seule si aucun callback de gestion n'est fourni. */
function FolderView({
  folders,
  documents,
  currentFolderId,
  onNavigate,
  canDelete,
  crmId,
  onDocChanged,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveDocument,
  uploadForm,
  selectedDocIds,
  onToggleSelectDoc,
}: {
  folders: FolderNode[];
  documents: Document[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  canDelete: boolean;
  crmId: string;
  onDocChanged?: () => void;
  onCreateFolder?: (name: string) => void;
  onRenameFolder?: (folderId: string, name: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  /** Déplacer un dossier — permis au propriétaire du coffre-fort (pas de renommer/supprimer) et à l'administration. */
  onMoveFolder?: (folderId: string) => void;
  /** Déplacer un document — mêmes droits que onMoveFolder. */
  onMoveDocument?: (docId: string) => void;
  uploadForm?: React.ReactNode;
  /** Sélection multi-fiches pour "Transformer en tableau de comptabilité" (voir AdminVaultPanel) — visible pour toutes les catégories, mais seule TIMESHEET_EMPLOYEE reste réellement transformable. */
  selectedDocIds?: Set<string>;
  onToggleSelectDoc?: (id: string) => void;
}) {
  const canCreateFolder = !!onCreateFolder;
  const subfolders = folders.filter((f) => f.parentId === currentFolderId);
  const docsHere = documents.filter((d) => d.folderId === currentFolderId);

  const breadcrumb: FolderNode[] = [];
  let cursor = folders.find((f) => f.id === currentFolderId) ?? null;
  while (cursor) {
    breadcrumb.unshift(cursor);
    cursor = folders.find((f) => f.id === cursor!.parentId) ?? null;
  }

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <button onClick={() => onNavigate(null)} className={cn("hover:text-text", currentFolderId === null && "font-medium text-text")}>
          Racine
        </button>
        {breadcrumb.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button onClick={() => onNavigate(f.id)} className={cn("hover:text-text", f.id === currentFolderId && "font-medium text-text")}>
              {f.name}
            </button>
          </span>
        ))}
      </div>

      {(subfolders.length > 0 || canCreateFolder) && (
        <div className="space-y-1">
          {subfolders.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
              {renamingId === f.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRenameFolder?.(f.id, renameValue);
                    setRenamingId(null);
                  }}
                  className="flex flex-1 items-center gap-2"
                >
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-7 flex-1" autoFocus />
                  <Button type="submit" size="sm" variant="ghost">
                    OK
                  </Button>
                  <button type="button" onClick={() => setRenamingId(null)} className="text-muted hover:text-text">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <>
                  <button onClick={() => onNavigate(f.id)} className="flex flex-1 items-center gap-2 text-left text-sm text-text hover:text-brand">
                    <Folder className="h-4 w-4 text-muted" /> {f.name}
                  </button>
                  {onMoveFolder && (
                    <button onClick={() => onMoveFolder(f.id)} className="text-muted hover:text-brand" title="Déplacer">
                      <Move className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onRenameFolder && (
                    <button
                      onClick={() => {
                        setRenamingId(f.id);
                        setRenameValue(f.name);
                      }}
                      className="text-muted hover:text-text"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDeleteFolder && (
                    <button onClick={() => onDeleteFolder(f.id)} className="text-muted hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          {canCreateFolder &&
            (creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newName.trim()) onCreateFolder?.(newName.trim());
                  setNewName("");
                  setCreating(false);
                }}
                className="flex items-center gap-2 px-2.5 py-1.5"
              >
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom du dossier" className="h-7 flex-1" autoFocus />
                <Button type="submit" size="sm" variant="ghost">
                  Créer
                </Button>
                <button type="button" onClick={() => setCreating(false)} className="text-muted hover:text-text">
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted hover:text-brand">
                <FolderPlus className="h-3.5 w-3.5" /> Nouveau dossier
              </button>
            ))}
        </div>
      )}

      {uploadForm}

      {docsHere.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Aucun document ici.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {docsHere.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              canDelete={canDelete}
              crmId={crmId}
              onChanged={onDocChanged}
              selectable={!!onToggleSelectDoc && doc.category === "TIMESHEET_EMPLOYEE"}
              selected={selectedDocIds?.has(doc.id)}
              onToggleSelect={onToggleSelectDoc}
              onMove={onMoveDocument ? () => onMoveDocument(doc.id) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sélecteur de dossier de destination pour "Déplacer" (fichier ou
 * dossier) — une liste cliquable plutôt qu'un glisser-déposer, comme
 * demandé. Pour un dossier déplacé, excludeSubtreeOf exclut ce dossier et
 * tous ses descendants (impossible de le déposer dans son propre
 * sous-arbre).
 */
function FolderPickerModal({
  open,
  title,
  folders,
  excludeSubtreeOf,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  folders: FolderNode[];
  excludeSubtreeOf?: string | null;
  onClose: () => void;
  onPick: (targetFolderId: string | null) => void;
}) {
  const excluded = new Set<string>();
  if (excludeSubtreeOf) {
    const collect = (id: string) => {
      excluded.add(id);
      folders.filter((f) => f.parentId === id).forEach((f) => collect(f.id));
    };
    collect(excludeSubtreeOf);
  }
  const visible = folders.filter((f) => !excluded.has(f.id));

  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    const children = visible.filter((f) => f.parentId === parentId);
    if (children.length === 0) return null;
    return (
      <ul className={depth > 0 ? "ml-4 border-l border-border pl-2" : ""}>
        {children.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick(f.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-bg-subtle"
            >
              <Folder className="h-4 w-4 text-muted" /> {f.name}
            </button>
            {renderLevel(f.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-text hover:bg-bg-subtle"
        >
          Racine
        </button>
        {renderLevel(null, 0)}
        {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">Aucun autre dossier disponible.</p>}
      </div>
    </Modal>
  );
}

export function AdminVaultPanel({ crmId, members }: { crmId: string; members: Member[] }) {
  const [selected, setSelected] = useState<Member | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Sélection de fiches de pointage salarié pour "Transformer en tableau de
  // comptabilité" — persiste à travers la navigation entre dossiers (les
  // fiches d'un même salarié sur un même chantier sont déposées dans des
  // dossiers distincts, un par semaine), mais jamais entre deux salariés.
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportPending, startExportTransition] = useTransition();
  const [moveTarget, setMoveTarget] = useState<{ type: "folder" | "document"; id: string } | null>(null);

  function toggleSelectDoc(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (selected) savePersistedSelection(crmId, selected.id, next);
      return next;
    });
    setExportSuccess(false);
    setExportError(null);
  }

  function navigateFolder(folderId: string | null) {
    setCurrentFolderId(folderId);
    if (selected) savePersistedActive(crmId, { employeeId: selected.id, folderId });
  }

  async function openMember(m: Member, restoreFolderId: string | null = null) {
    setSelected(m);
    setCurrentFolderId(restoreFolderId);
    setSelectedDocIds(loadPersistedSelection(crmId, m.id));
    setExportError(null);
    setExportSuccess(false);
    savePersistedActive(crmId, { employeeId: m.id, folderId: restoreFolderId });
    setLoading(true);
    const [list, folderList] = await Promise.all([listVaultDocumentsForUser(crmId, m.id), listVaultFoldersForUser(crmId, m.id)]);
    setDocs(list);
    setFolders(folderList);
    setLoading(false);
  }

  function closeMember() {
    setSelected(null);
    savePersistedActive(crmId, null);
  }

  // Rouvre le salarié/dossier consultés avant un rechargement complet de
  // la page (bouton précédent, onglet déchargé en arrière-plan...) : sans
  // ça, la sélection restaurée par openMember ne serait jamais visible,
  // l'utilisatrice retombant sur la liste des salariés.
  useEffect(() => {
    const active = loadPersistedActive(crmId);
    const member = active && members.find((m) => m.id === active.employeeId);
    if (member) void openMember(member, active!.folderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGenerateExport() {
    if (!selected || selectedDocIds.size === 0) return;
    setExportError(null);
    setExportSuccess(false);
    startExportTransition(async () => {
      const res = await generateAccountingExport(crmId, selected.id, Array.from(selectedDocIds));
      if (!res.ok) {
        setExportError(res.error ?? "Erreur lors de la génération du tableau.");
        return;
      }
      setSelectedDocIds(new Set());
      savePersistedSelection(crmId, selected.id, new Set());
      setExportSuccess(true);
      await refreshSelected();
    });
  }

  async function refreshSelected() {
    if (!selected) return;
    const [list, folderList] = await Promise.all([
      listVaultDocumentsForUser(crmId, selected.id),
      listVaultFoldersForUser(crmId, selected.id),
    ]);
    setDocs(list);
    setFolders(folderList);
  }

  function handleUpload(formData: FormData) {
    if (!selected) return;
    formData.set("folderId", currentFolderId ?? "");
    setUploadError(null);
    startTransition(async () => {
      const res = await uploadVaultDocument(crmId, selected.id, formData);
      if (!res.ok) {
        setUploadError(res.error ?? "Erreur lors de l'envoi.");
        return;
      }
      await refreshSelected();
    });
  }

  function handleCreateFolder(name: string) {
    if (!selected) return;
    startTransition(async () => {
      await createVaultFolder(crmId, selected.id, name, currentFolderId);
      await refreshSelected();
    });
  }

  function handleRenameFolder(folderId: string, name: string) {
    startTransition(async () => {
      await renameVaultFolder(crmId, folderId, name);
      await refreshSelected();
    });
  }

  function handleDeleteFolder(folderId: string) {
    if (!confirm("Supprimer ce dossier ? Il doit être vide.")) return;
    startTransition(async () => {
      const res = await deleteVaultFolder(crmId, folderId);
      if (!res.ok) alert(res.error ?? "Erreur.");
      await refreshSelected();
    });
  }

  function handleMove(targetFolderId: string | null) {
    if (!moveTarget) return;
    const { type, id } = moveTarget;
    setMoveTarget(null);
    startTransition(async () => {
      const res =
        type === "folder" ? await moveVaultFolder(crmId, id, targetFolderId) : await moveVaultDocument(crmId, id, targetFolderId);
      if (!res.ok) alert(res.error ?? "Erreur.");
      await refreshSelected();
    });
  }

  if (selected) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={closeMember} className="text-muted hover:text-text">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: selected.color }}
            >
              {initials(selected.firstName, selected.lastName)}
            </span>
            <CardTitle>
              Coffre-fort de {selected.firstName} {selected.lastName}
            </CardTitle>
          </div>
          <Badge variant={selected.category === "OUVRIER" ? "warning" : "brand"}>
            {selected.category === "OUVRIER" ? "Ouvrier" : "Commercial"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedDocIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand/40 bg-brand/5 px-3 py-2.5">
              <p className="text-sm text-text">
                {selectedDocIds.size} fiche{selectedDocIds.size > 1 ? "s" : ""} de pointage sélectionnée{selectedDocIds.size > 1 ? "s" : ""}
              </p>
              <Button size="sm" disabled={exportPending} onClick={handleGenerateExport}>
                <FileSpreadsheet className="h-4 w-4" />
                {exportPending ? "Génération..." : "Transformer en tableau de comptabilité"}
              </Button>
            </div>
          )}
          {exportError && <p className="text-sm text-red-500">{exportError}</p>}
          {exportSuccess && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Tableau généré et déposé dans le dossier « Comptabilité » de {selected.firstName}.
            </p>
          )}
          {loading ? (
            <p className="text-sm text-muted">Chargement...</p>
          ) : (
            <FolderView
              folders={folders}
              documents={docs}
              currentFolderId={currentFolderId}
              onNavigate={navigateFolder}
              canDelete
              crmId={crmId}
              onDocChanged={refreshSelected}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveFolder={(id) => setMoveTarget({ type: "folder", id })}
              onMoveDocument={(id) => setMoveTarget({ type: "document", id })}
              selectedDocIds={selectedDocIds}
              onToggleSelectDoc={toggleSelectDoc}
              uploadForm={
                <div>
                  <form action={handleUpload} className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3">
                    <div>
                      <Label htmlFor="category">Type</Label>
                      <Select id="category" name="category" defaultValue="DOCUMENT" className="w-44">
                        <option value="PAYSLIP">Fiche de paie</option>
                        <option value="DOCUMENT">Document</option>
                      </Select>
                    </div>
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                      <Label htmlFor="file">Fichier</Label>
                      <input
                        id="file"
                        name="file"
                        type="file"
                        required
                        className="block w-full min-w-0 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-bg-subtle file:px-3 file:py-1.5 file:text-sm"
                      />
                    </div>
                    <Button type="submit" disabled={isPending}>
                      <Upload className="h-4 w-4" /> {isPending ? "Envoi..." : "Déposer ici"}
                    </Button>
                  </form>
                  {uploadError && <p className="mt-1 text-sm text-red-500">{uploadError}</p>}
                </div>
              }
            />
          )}
        </CardContent>
        {moveTarget && (
          <FolderPickerModal
            open
            title={moveTarget.type === "folder" ? "Déplacer le dossier" : "Déplacer le fichier"}
            folders={folders}
            excludeSubtreeOf={moveTarget.type === "folder" ? moveTarget.id : null}
            onClose={() => setMoveTarget(null)}
            onPick={handleMove}
          />
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gérer les coffres-forts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => openMember(m)}
                className="flex w-full flex-col items-start gap-1.5 px-1 py-2.5 text-left hover:bg-bg-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    {initials(m.firstName, m.lastName)}
                  </span>
                  <p className="truncate text-sm text-text">
                    {m.firstName} {m.lastName}
                  </p>
                  <Badge variant={m.category === "OUVRIER" ? "warning" : "brand"} className="shrink-0">
                    {m.category === "OUVRIER" ? "Ouvrier" : "Commercial"}
                  </Badge>
                </div>
                <span className="pl-9 text-xs text-muted sm:pl-0">
                  {m.documentCount} document{m.documentCount > 1 ? "s" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * "Mon coffre-fort" — le propriétaire peut créer des dossiers et déplacer
 * ses fichiers/dossiers, mais jamais les renommer ni les supprimer
 * (onRenameFolder/onDeleteFolder/canDelete volontairement absents) :
 * seule l'administration (AdminVaultPanel) garde ces droits, à la
 * demande explicite du client.
 */
function MyVaultCard({
  crmId,
  initialDocuments,
  initialFolders,
}: {
  crmId: string;
  initialDocuments: Document[];
  initialFolders: FolderNode[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [folders, setFolders] = useState(initialFolders);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [moveTarget, setMoveTarget] = useState<{ type: "folder" | "document"; id: string } | null>(null);

  async function refresh() {
    const [docs, fs] = await Promise.all([listMyVaultDocuments(crmId), listMyVaultFolders(crmId)]);
    setDocuments(docs);
    setFolders(fs);
  }

  function handleCreateFolder(name: string) {
    startTransition(async () => {
      await createMyVaultFolder(crmId, name, currentFolderId);
      await refresh();
    });
  }

  function handleMove(targetFolderId: string | null) {
    if (!moveTarget) return;
    const { type, id } = moveTarget;
    setMoveTarget(null);
    startTransition(async () => {
      const res =
        type === "folder" ? await moveVaultFolder(crmId, id, targetFolderId) : await moveVaultDocument(crmId, id, targetFolderId);
      if (!res.ok) alert(res.error ?? "Erreur.");
      await refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted" />
        <CardTitle>Mon coffre-fort</CardTitle>
      </CardHeader>
      <CardContent>
        <FolderView
          folders={folders}
          documents={documents}
          currentFolderId={currentFolderId}
          onNavigate={setCurrentFolderId}
          canDelete={false}
          crmId={crmId}
          onCreateFolder={handleCreateFolder}
          onMoveFolder={(id) => setMoveTarget({ type: "folder", id })}
          onMoveDocument={(id) => setMoveTarget({ type: "document", id })}
        />
      </CardContent>
      {moveTarget && (
        <FolderPickerModal
          open
          title={moveTarget.type === "folder" ? "Déplacer le dossier" : "Déplacer le fichier"}
          folders={folders}
          excludeSubtreeOf={moveTarget.type === "folder" ? moveTarget.id : null}
          onClose={() => setMoveTarget(null)}
          onPick={handleMove}
        />
      )}
    </Card>
  );
}

export function VaultClient({
  crmId,
  canManage,
  myDocuments,
  myFolders,
  members,
}: {
  crmId: string;
  canManage: boolean;
  myDocuments: Document[];
  myFolders: FolderNode[];
  members: Member[];
}) {
  return (
    <div className={cn("space-y-6", canManage && "grid grid-cols-1 gap-6 lg:grid-cols-2 space-y-0")}>
      <MyVaultCard crmId={crmId} initialDocuments={myDocuments} initialFolders={myFolders} />

      {canManage && <AdminVaultPanel crmId={crmId} members={members} />}
    </div>
  );
}