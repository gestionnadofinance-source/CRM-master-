"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Star } from "lucide-react";
import { createVatRate, deleteVatRate, setDefaultVatRate } from "@/server/settings/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";

export interface VatRateRow {
  id: string;
  label: string;
  rate: string;
  isDefault: boolean;
}

export function VatSection({ crmId, crmSlug, rates }: { crmId: string; crmSlug: string; rates: VatRateRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createVatRate(crmId, crmSlug, fd);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else {
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    });
  }

  function onDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteVatRate(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  function onSetDefault(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await setDefaultVatRate(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taux de TVA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-sm text-text">
                {r.label} <span className="text-muted">({r.rate}%)</span>
                {r.isDefault && <Badge variant="brand">Par défaut</Badge>}
              </div>
              <div className="flex items-center gap-1">
                {!r.isDefault && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => onSetDefault(r.id)}>
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(r.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </li>
          ))}
          {rates.length === 0 && <li className="py-2 text-sm text-muted">Aucun taux.</li>}
        </ul>

        <form onSubmit={onCreate} className="grid grid-cols-5 items-end gap-2 border-t border-border pt-4">
          <div className="col-span-2">
            <Label htmlFor="vat-label">Libellé</Label>
            <Input id="vat-label" name="label" required />
          </div>
          <div>
            <Label htmlFor="vat-rate">Taux (%)</Label>
            <Input id="vat-rate" name="rate" type="number" step="0.01" min="0" max="100" required />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" name="isDefault" className="h-3.5 w-3.5" /> Par défaut
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
