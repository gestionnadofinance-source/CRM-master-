"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { countUsersToPurge, purgeAllOtherUsers } from "@/server/admin/actions";
import { PURGE_CONFIRMATION } from "@/lib/purge-confirmation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/modal";

/** Zone de nettoyage : supprimer tous les comptes sauf celui de l'administrateur connecté. */
export function PurgeUsersCard({ selfEmail }: { selfEmail: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function ouvrir() {
    setPhrase("");
    setError(null);
    setCount(null);
    setOpen(true);
    startTransition(async () => setCount(await countUsersToPurge()));
  }

  function lancer() {
    setError(null);
    startTransition(async () => {
      const res = await purgeAllOtherUsers(phrase);
      if (!res.ok) {
        setError(res.error ?? "Erreur.");
        return;
      }
      setOpen(false);
      setDone(
        `${res.deletedUsers} compte${res.deletedUsers === 1 ? "" : "s"} supprimé${res.deletedUsers === 1 ? "" : "s"}, ` +
          `${res.removedFiles} fichier${res.removedFiles === 1 ? "" : "s"} de coffre-fort effacé${res.removedFiles === 1 ? "" : "s"}.`
      );
      router.refresh();
    });
  }

  return (
    <Card className="space-y-2 border-red-500/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-text">Nettoyage</p>
          <p className="text-sm text-muted">
            Supprimer tous les utilisateurs sauf votre compte ({selfEmail}), avec leurs données. Irréversible.
          </p>
        </div>
        <Button variant="danger" size="sm" className="shrink-0" onClick={ouvrir}>
          <Trash2 className="h-3.5 w-3.5" /> Supprimer tous les autres utilisateurs
        </Button>
      </div>
      {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}

      <Modal open={open} onClose={() => setOpen(false)} title="Supprimer tous les autres utilisateurs" width="md">
        <div className="space-y-3 text-sm text-text">
          <p className="font-medium">
            {count === null
              ? "Comptage des comptes concernés…"
              : `${count} compte${count === 1 ? "" : "s"} ser${count === 1 ? "a" : "ont"} supprimé${count === 1 ? "" : "s"}. Seul votre compte (${selfEmail}) est conservé.`}
          </p>
          <div>
            <p className="text-muted">Supprimé définitivement avec chaque compte :</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              <li>accès aux espaces et affectations aux chantiers ;</li>
              <li>pointages, acomptes, absences ;</li>
              <li>coffre-fort : dossiers, documents et fichiers (fiches de paie, pointages, ordres de mission) ;</li>
              <li>notifications, sessions ouvertes, clés d&apos;API qu&apos;il a créées.</li>
            </ul>
          </div>
          <p className="text-muted">
            Conservés et rattachés à votre compte : les chantiers, les réglages des espaces et le journal d&apos;activité.
          </p>
          <div>
            <Label htmlFor="purge-confirm" className="text-xs">
              Pour confirmer, recopiez : <strong>{PURGE_CONFIRMATION}</strong>
            </Label>
            <Input
              id="purge-confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              placeholder={PURGE_CONFIRMATION}
            />
          </div>
          {error && <p className="text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending || count === null || count === 0 || phrase.trim() !== PURGE_CONFIRMATION}
              onClick={lancer}
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
