"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound } from "lucide-react";
import { disableUser, reactivateUser, regenerateUserPassword, setUserPassword } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/modal";

export function UserRowActions({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: "ACTIVE" | "DISABLED";
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const router = useRouter();

  function toggleStatus() {
    startTransition(async () => {
      const res = status === "ACTIVE" ? await disableUser(userId) : await reactivateUser(userId);
      if (!res.ok) setMessage(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setPasswordModalOpen(true)}>
          <KeyRound className="h-3.5 w-3.5" /> Mot de passe
        </Button>
        {!isSelf && (
          <Button
            size="sm"
            variant={status === "ACTIVE" ? "danger" : "secondary"}
            disabled={pending}
            onClick={toggleStatus}
          >
            {status === "ACTIVE" ? "Désactiver" : "Réactiver"}
          </Button>
        )}
      </div>
      {message && <p className="max-w-xs text-right text-xs text-muted">{message}</p>}

      <PasswordModal userId={userId} open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
    </div>
  );
}

function PasswordModal({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [customPassword, setCustomPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [customSuccess, setCustomSuccess] = useState(false);

  function reset() {
    setTemporaryPassword(null);
    setCustomPassword("");
    setError(null);
    setCustomSuccess(false);
  }

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const res = await regenerateUserPassword(userId);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else setTemporaryPassword(res.temporaryPassword ?? null);
    });
  }

  function handleSetCustom(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCustomSuccess(false);
    startTransition(async () => {
      const fd = new FormData(e.currentTarget);
      const res = await setUserPassword(userId, fd);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else setCustomSuccess(true);
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Gérer le mot de passe"
      width="sm"
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm text-muted">
            Générer un nouveau mot de passe temporaire aléatoire, à communiquer vous-même à l&apos;utilisateur. Il devra
            le changer à sa prochaine connexion.
          </p>
          <Button size="sm" variant="outline" disabled={pending} onClick={handleRegenerate}>
            Générer un mot de passe temporaire
          </Button>
          {temporaryPassword && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2">
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
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm text-muted">Ou définir vous-même le mot de passe exact de l&apos;utilisateur :</p>
          <form onSubmit={handleSetCustom} className="space-y-2">
            <div>
              <Label htmlFor="password" className="text-xs">
                Nouveau mot de passe
              </Label>
              <Input
                id="password"
                name="password"
                type="text"
                required
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="Au moins 10 caractères, maj/min/chiffre"
              />
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              Définir ce mot de passe
            </Button>
            {customSuccess && <p className="text-xs text-emerald-700 dark:text-emerald-400">Mot de passe défini.</p>}
          </form>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
