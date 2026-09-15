"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrm } from "@/server/admin/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const COLORS = ["#3b6bf5", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

export function CreateCrmForm({ onCreated }: { onCreated?: (crmSlug: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createCrm(fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      router.refresh();
      if (res.crmSlug) onCreated?.(res.crmSlug);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Nom du CRM *</Label>
        <Input id="name" name="name" required placeholder="Ex : Ma Nouvelle Activité" />
      </div>
      <div>
        <Label htmlFor="slug">Identifiant d&apos;URL (optionnel)</Label>
        <Input id="slug" name="slug" placeholder="généré automatiquement si vide" />
        <p className="mt-1 text-xs text-muted">
          Utilisé dans les URLs (/c/mon-crm/...) et ne pourra plus être modifié après création.
        </p>
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>
      <div>
        <Label>Couleur</Label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <label key={c}>
              <input type="radio" name="color" value={c} defaultChecked={c === COLORS[0]} className="peer sr-only" />
              <span
                className="block h-7 w-7 cursor-pointer rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-brand"
                style={{ backgroundColor: c }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-muted">
        À la création, le CRM reçoit automatiquement : les paramètres entreprise et réservation par défaut, un
        pipeline en 7 étapes, 10 sources, 4 taux de TVA et un compteur de devis — sans configuration
        supplémentaire.
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Création..." : "Créer le CRM"}
        </Button>
      </div>
    </form>
  );
}
