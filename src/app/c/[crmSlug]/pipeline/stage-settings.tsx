"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, Trash2, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { createStage, updateStage, reorderStages, deleteStage } from "@/server/pipeline/actions";

interface Stage {
  id: string;
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
  opportunityCount: number;
}

export function StageSettingsButton({ crmId, stages }: { crmId: string; stages: Stage[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings className="h-4 w-4" /> Configurer les étapes
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Étapes du pipeline" width="lg">
        <StageSettingsPanel crmId={crmId} stages={stages} onChange={() => router.refresh()} />
      </Modal>
    </>
  );
}

function StageSettingsPanel({ crmId, stages, onChange }: { crmId: string; stages: Stage[]; onChange: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Stage | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const reordered = [...stages];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item!);
    startTransition(async () => {
      await reorderStages(crmId, reordered.map((s) => s.id));
      onChange();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="rounded-md border border-border p-3">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setError(null);
                startTransition(async () => {
                  const res = await updateStage(crmId, stage.id, fd);
                  if (!res.ok) setError(res.error ?? "Erreur");
                  else onChange();
                });
              }}
            >
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input name="name" defaultValue={stage.name} className="w-40" required />
              <input type="color" name="color" defaultValue={stage.color} className="h-9 w-9 rounded border border-border" />
              <label className="flex items-center gap-1 text-xs text-text">
                <input type="checkbox" name="isWon" defaultChecked={stage.isWon} /> Gagné
              </label>
              <label className="flex items-center gap-1 text-xs text-text">
                <input type="checkbox" name="isLost" defaultChecked={stage.isLost} /> Perdu
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                Enregistrer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setReassignTo(stages.find((s) => s.id !== stage.id)?.id ?? "");
                  setPendingDelete(stage);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </form>
            <p className="mt-1 text-[11px] text-muted">{stage.opportunityCount} opportunité(s) dans cette étape</p>
          </li>
        ))}
      </ul>

      {pendingDelete && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="mb-2 text-amber-700 dark:text-amber-400">
            Supprimer &quot;{pendingDelete.name}&quot;
            {pendingDelete.opportunityCount > 0 && ` (${pendingDelete.opportunityCount} opportunité(s) à réaffecter)`} ?
          </p>
          {pendingDelete.opportunityCount > 0 && (
            <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className="mb-2 w-64">
              {stages
                .filter((s) => s.id !== pendingDelete.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    Réaffecter vers : {s.name}
                  </option>
                ))}
            </Select>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteStage(crmId, pendingDelete.id, reassignTo || undefined);
                  if (!res.ok) setError(res.error ?? "Erreur");
                  else {
                    setPendingDelete(null);
                    onChange();
                  }
                })
              }
            >
              Confirmer la suppression
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <form
        className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setError(null);
          startTransition(async () => {
            const res = await createStage(crmId, fd);
            if (!res.ok) setError(res.error ?? "Erreur");
            else {
              form.reset();
              onChange();
            }
          });
        }}
      >
        <div>
          <Label htmlFor="new-stage-name">Nouvelle étape</Label>
          <Input id="new-stage-name" name="name" placeholder="Nom de l'étape" required />
        </div>
        <input type="color" name="color" defaultValue="#94a3b8" className="h-9 w-9 rounded border border-border" />
        <label className="flex items-center gap-1 text-xs text-text">
          <input type="checkbox" name="isWon" /> Gagné
        </label>
        <label className="flex items-center gap-1 text-xs text-text">
          <input type="checkbox" name="isLost" /> Perdu
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </form>
    </div>
  );
}
