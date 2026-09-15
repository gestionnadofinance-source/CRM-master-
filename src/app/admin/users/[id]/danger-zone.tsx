"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { deleteUserActivityHistory } from "@/server/admin/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";

export function DangerZone({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const canConfirm = confirmText.trim().toLowerCase() === email.trim().toLowerCase();

  function onConfirm() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteUserActivityHistory(userId, confirmText);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <Card className="border-red-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          Zone dangereuse
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Supprime définitivement les entrées du journal d&apos;activité de cet utilisateur (historique des actions
          uniquement). Son compte et son travail (clients, devis, rendez-vous...) ne sont jamais affectés.
        </p>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          Supprimer l&apos;historique d&apos;actions
        </Button>
      </CardContent>

      <Modal open={open} onClose={() => setOpen(false)} title="Confirmer la suppression" width="sm">
        <div className="space-y-4">
          <p className="text-sm text-text">
            Cette action est irréversible. Pour confirmer, saisissez l&apos;adresse email exacte de l&apos;utilisateur :{" "}
            <strong>{email}</strong>
          </p>
          <div>
            <Label htmlFor="confirmEmail">Adresse email</Label>
            <Input
              id="confirmEmail"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" disabled={!canConfirm || pending} onClick={onConfirm}>
              {pending ? "Suppression..." : "Confirmer la suppression"}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
