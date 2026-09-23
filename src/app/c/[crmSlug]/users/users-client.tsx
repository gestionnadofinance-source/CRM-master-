"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound, Pencil } from "lucide-react";
import {
  createCrmUser,
  updateCrmUserAccess,
  disableCrmUser,
  reactivateCrmUser,
  regenerateCrmUserPassword,
  type CreateCrmUserResult,
} from "@/server/crm-users/actions";
import { Card, Badge } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { formatDate, initials } from "@/lib/utils";

type Category = "COMMERCIAL" | "OUVRIER" | "SECRETAIRE";
type Role = "MANAGER" | "USER";

export interface CrmUserRow {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  lastSeenAt: Date | string | null;
  role: Role;
  category: Category;
  isForeman: boolean;
}

function categoryLabel(category: Category, isForeman: boolean): string {
  if (category === "SECRETAIRE") return "Secrétaire";
  if (category === "OUVRIER") return isForeman ? "Ouvrier — Chef de chantier" : "Ouvrier";
  return "Commercial";
}

function categoryBadgeVariant(category: Category): "default" | "warning" | "brand" {
  if (category === "SECRETAIRE") return "brand";
  if (category === "OUVRIER") return "warning";
  return "default";
}

export function UsersClient({
  crmId,
  initialUsers,
  currentUserId,
}: {
  crmId: string;
  initialUsers: CrmUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CrmUserRow | null>(null);
  const [passwordFor, setPasswordFor] = useState<CrmUserRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Nouvel utilisateur
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Utilisateur</th>
                <th className="px-4 py-2.5 font-medium">Accès</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Dernière connexion</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialUsers.map((u) => (
                <tr key={u.userId} className="hover:bg-bg-subtle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                        {initials(u.firstName, u.lastName)}
                      </span>
                      <span>
                        <span className="block font-medium text-text">
                          {u.firstName} {u.lastName}
                        </span>
                        <span className="block text-xs text-muted">{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={categoryBadgeVariant(u.category)}>{categoryLabel(u.category, u.isForeman)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.status === "ACTIVE" ? "success" : "danger"}>
                      {u.status === "ACTIVE" ? "Actif" : "Désactivé"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{u.lastSeenAt ? formatDate(u.lastSeenAt, true) : "Jamais"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPasswordFor(u)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {u.userId !== currentUserId && (
                        <ToggleStatusButton crmId={crmId} user={u} onDone={() => router.refresh()} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {initialUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Aucun utilisateur pour ce CRM.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserModal crmId={crmId} open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => router.refresh()} />
      {editing && (
        <EditUserModal
          crmId={crmId}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {passwordFor && <PasswordModal crmId={crmId} userId={passwordFor.userId} onClose={() => setPasswordFor(null)} />}
    </div>
  );
}

function ToggleStatusButton({
  crmId,
  user,
  onDone,
}: {
  crmId: string;
  user: CrmUserRow;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = user.status === "ACTIVE" ? await disableCrmUser(crmId, user.userId) : await reactivateCrmUser(crmId, user.userId);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else onDone();
    });
  }

  return (
    <div className="flex flex-col items-end">
      <Button size="sm" variant={user.status === "ACTIVE" ? "danger" : "secondary"} disabled={pending} onClick={toggle}>
        {user.status === "ACTIVE" ? "Désactiver" : "Réactiver"}
      </Button>
      {error && <p className="mt-1 max-w-[10rem] text-right text-xs text-red-500">{error}</p>}
    </div>
  );
}

function CategoryRoleFields({
  category,
  setCategory,
  role,
  isForeman,
  setIsForeman,
}: {
  category: Category;
  setCategory: (c: Category) => void;
  role: Role;
  isForeman: boolean;
  setIsForeman: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label htmlFor="category">Profil</Label>
        <Select id="category" name="category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          <option value="OUVRIER">Ouvrier</option>
          <option value="SECRETAIRE">Secrétaire</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="role">Rôle</Label>
        <Select id="role" name="role" defaultValue={role}>
          <option value="USER">Utilisateur</option>
          <option value="MANAGER">Responsable</option>
        </Select>
      </div>
      {category === "OUVRIER" && (
        <label className="col-span-2 flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            name="isForeman"
            checked={isForeman}
            onChange={(e) => setIsForeman(e.target.checked)}
            className="h-4 w-4"
          />
          Chef de chantier (gère les feuilles de pointage des chantiers auxquels il est affecté)
        </label>
      )}
      {category === "SECRETAIRE" && (
        <p className="col-span-2 text-xs text-muted">
          Accès total à l&apos;administration du CRM (Tableau de bord, Utilisateurs, Planning, Pointage, Coffre-fort,
          Activité), sans accès aux données commerciales (Pipeline, Clients, Prospects, Devis, Agenda, Tâches,
          Messagerie).
        </p>
      )}
    </div>
  );
}

function CreateUserModal({
  crmId,
  open,
  onClose,
  onCreated,
}: {
  crmId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCrmUserResult | null>(null);
  const [category, setCategory] = useState<Category>("OUVRIER");
  const [isForeman, setIsForeman] = useState(false);
  const [copied, setCopied] = useState(false);

  function reset() {
    setError(null);
    setResult(null);
    setCategory("OUVRIER");
    setIsForeman(false);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createCrmUser(crmId, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setResult(res);
      onCreated();
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Nouvel utilisateur"
    >
      {result?.ok ? (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            <p className="font-medium">Utilisateur créé avec succès.</p>
            <p className="mt-1">
              Communiquez son identifiant (email) et le mot de passe temporaire ci-dessous — il devra le changer à sa
              première connexion.
              {result.emailDelivered ? " Un email récapitulatif lui a aussi été envoyé." : ""}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2">
            <code className="text-sm font-semibold text-text">{result.temporaryPassword}</code>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted hover:text-brand"
              onClick={() => {
                navigator.clipboard.writeText(result.temporaryPassword ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Fermer
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">Prénom *</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div>
              <Label htmlFor="lastName">Nom *</Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div className="col-span-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" name="email" type="email" required />
            </div>
          </div>
          <CategoryRoleFields category={category} setCategory={setCategory} role="USER" isForeman={isForeman} setIsForeman={setIsForeman} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Création..." : "Créer l'utilisateur"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditUserModal({
  crmId,
  user,
  onClose,
  onSaved,
}: {
  crmId: string;
  user: CrmUserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(user.category);
  const [isForeman, setIsForeman] = useState(user.isForeman);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await updateCrmUserAccess(crmId, user.userId, fd);
      if (!res.ok) setError(res.error ?? "Une erreur est survenue.");
      else onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Modifier ${user.firstName} ${user.lastName}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="edit-firstName">Prénom *</Label>
            <Input id="edit-firstName" name="firstName" defaultValue={user.firstName} required />
          </div>
          <div>
            <Label htmlFor="edit-lastName">Nom *</Label>
            <Input id="edit-lastName" name="lastName" defaultValue={user.lastName} required />
          </div>
        </div>
        <CategoryRoleFields category={category} setCategory={setCategory} role={user.role} isForeman={isForeman} setIsForeman={setIsForeman} />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ crmId, userId, onClose }: { crmId: string; userId: string; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const res = await regenerateCrmUserPassword(crmId, userId);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else setTemporaryPassword(res.temporaryPassword ?? null);
    });
  }

  return (
    <Modal open onClose={onClose} title="Gérer le mot de passe" width="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Générer un nouveau mot de passe temporaire aléatoire, à communiquer vous-même à l&apos;utilisateur. Il devra
          le changer à sa prochaine connexion.
        </p>
        <Button size="sm" variant="outline" disabled={pending} onClick={handleRegenerate}>
          Générer un mot de passe temporaire
        </Button>
        {temporaryPassword && (
          <div className="flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2">
            <code className="text-sm font-semibold text-text">{temporaryPassword}</code>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted hover:text-brand"
              onClick={() => {
                navigator.clipboard.writeText(temporaryPassword);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
