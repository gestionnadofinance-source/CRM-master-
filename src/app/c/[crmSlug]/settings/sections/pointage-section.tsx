"use client";

import { useState, useTransition } from "react";
import { updatePointageSettings } from "@/server/pointage/actions";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface PointageSettingsData {
  nightRatePercent: number;
  /** Voir SundayHolidayRule dans prisma/schema.prisma. */
  sundayHolidayRule: "CUMUL" | "FERIE_PRIORITAIRE" | "DIMANCHE_PRIORITAIRE";
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
            <div>
              <Label htmlFor="sundayHolidayRule">Dimanche qui est aussi férié</Label>
              <Select id="sundayHolidayRule" name="sundayHolidayRule" defaultValue={initial.sundayHolidayRule}>
                <option value="FERIE_PRIORITAIRE">Compter en jour férié seulement</option>
                <option value="DIMANCHE_PRIORITAIRE">Compter en dimanche seulement</option>
                <option value="CUMUL">Compter dans les deux (deux majorations)</option>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted">
            Une heure travaillée un dimanche férié ne doit pas être majorée deux fois sans que ce soit voulu.
            La règle dépend de votre convention collective ; l&apos;export Silae signale chaque cas rencontré,
            quelle que soit l&apos;option retenue.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-700 dark:text-emerald-400">Enregistré.</p>}

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
