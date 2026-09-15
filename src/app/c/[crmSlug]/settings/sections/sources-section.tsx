"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createSource, deleteSource } from "@/server/settings/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface SourceRow {
  id: string;
  name: string;
  order: number;
}

export function SourcesSection({ crmId, crmSlug, sources }: { crmId: string; crmSlug: string; sources: SourceRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createSource(crmId, crmSlug, fd);
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
      const res = await deleteSource(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {sources
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-text">{s.name}</span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(s.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </li>
            ))}
          {sources.length === 0 && <li className="py-2 text-sm text-muted">Aucune source.</li>}
        </ul>

        <form onSubmit={onCreate} className="flex items-end gap-2 border-t border-border pt-4">
          <div className="flex-1">
            <Label htmlFor="source-name">Nouvelle source</Label>
            <Input id="source-name" name="name" required />
          </div>
          <input type="hidden" name="order" value={sources.length} />
          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
