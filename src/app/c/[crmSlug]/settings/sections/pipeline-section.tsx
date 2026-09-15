"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createPipelineStage, deletePipelineStage } from "@/server/settings/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";

export interface StageRow {
  id: string;
  name: string;
  order: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

export function PipelineSection({ crmId, crmSlug, stages }: { crmId: string; crmSlug: string; stages: StageRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createPipelineStage(crmId, crmSlug, fd);
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
      const res = await deletePipelineStage(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline commercial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {stages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-sm text-text">{s.name}</span>
                  <span className="text-xs text-muted">#{s.order}</span>
                  {s.isWon && <Badge variant="success">Gagné</Badge>}
                  {s.isLost && <Badge variant="danger">Perdu</Badge>}
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(s.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </li>
            ))}
          {stages.length === 0 && <li className="py-2 text-sm text-muted">Aucune étape.</li>}
        </ul>

        <form onSubmit={onCreate} className="grid grid-cols-6 items-end gap-2 border-t border-border pt-4">
          <div className="col-span-2">
            <Label htmlFor="stage-name">Nom</Label>
            <Input id="stage-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="stage-order">Ordre</Label>
            <Input id="stage-order" name="order" type="number" defaultValue={stages.length} />
          </div>
          <div>
            <Label htmlFor="stage-color">Couleur</Label>
            <Input id="stage-color" name="color" type="color" defaultValue="#94a3b8" className="h-9 p-1" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" name="isWon" className="h-3.5 w-3.5" /> Gagné
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" name="isLost" className="h-3.5 w-3.5" /> Perdu
          </label>
          <div className="col-span-6 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="h-4 w-4" /> Ajouter une étape
            </Button>
          </div>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
