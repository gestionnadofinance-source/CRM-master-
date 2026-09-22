"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCrm } from "@/server/admin/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const COLORS = ["#3b6bf5", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

export function EditCrmForm({
  crmId,
  name,
  description,
  color,
  isActive,
}: {
  crmId: string;
  name: string;
  description: string;
  color: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateCrm(crmId, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Nom *</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} defaultValue={description} />
      </div>
      <div>
        <Label>Couleur</Label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <label key={c}>
              <input type="radio" name="color" value={c} defaultChecked={c === color} className="peer sr-only" />
              <span
                className="block h-7 w-7 cursor-pointer rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-brand"
                style={{ backgroundColor: c }}
              />
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" name="isActive" defaultChecked={isActive} className="h-4 w-4" />
        CRM actif (un CRM inactif devient inaccessible à tous les utilisateurs, y compris via un lien direct)
      </label>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Modifications enregistrées — le nouveau nom apparaîtra pour les utilisateurs concernés dès leur prochaine
          navigation ou actualisation.
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
