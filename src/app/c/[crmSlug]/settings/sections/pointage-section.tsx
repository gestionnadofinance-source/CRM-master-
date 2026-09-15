"use client";

import { useState, useTransition } from "react";
import { updatePointageSettings } from "@/server/pointage/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface PointageSettingsData {
  nightRatePercent: number;
}

export function PointageSection({ crmId, initial }: { crmId: string; initial: PointageSettingsData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updatePointageSettings(crmId, fd);
      if (!res.ok) setError(res.error ?? "Une erreur est survenue.");
      else setSuccess(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pointage — taux communs</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">
          Valeur suggérée, pré-remplie uniquement sur une toute nouvelle fiche de pointage. Le chef de chantier
          reste libre de la modifier ou de la laisser à 0 pour chaque salarié et chaque semaine, directement sur
          la fiche (Planning). Rien n&apos;apparaît sur le PDF tant qu&apos;un montant n&apos;a pas été choisi. Les
          indemnités de repas et de déplacement sont désormais fixées par chantier (Planning → fiche du chantier).
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nightRatePercent">Majoration heure de nuit (%)</Label>
              <Input id="nightRatePercent" name="nightRatePercent" type="number" min={0} step={1} defaultValue={initial.nightRatePercent} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Enregistré.</p>}

          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
