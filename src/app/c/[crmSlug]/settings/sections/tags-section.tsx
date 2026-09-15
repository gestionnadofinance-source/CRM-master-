"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createTag, deleteTag } from "@/server/settings/actions";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";

export interface TagRow {
  id: string;
  name: string;
  scope: "CLIENT" | "PROSPECT" | "USER";
  color: string;
}

const SCOPE_LABELS: Record<TagRow["scope"], string> = {
  CLIENT: "Client",
  PROSPECT: "Prospect",
  USER: "Utilisateur",
};

export function TagsSection({ crmId, crmSlug, tags }: { crmId: string; crmSlug: string; tags: TagRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createTag(crmId, crmSlug, fd);
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
      const res = await deleteTag(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5">
              <Badge style={{ backgroundColor: `${t.color}26`, color: t.color }}>
                {t.name} · {SCOPE_LABELS[t.scope]}
              </Badge>
              <button
                type="button"
                disabled={pending}
                onClick={() => onDelete(t.id)}
                className="text-muted hover:text-red-500"
                aria-label={`Supprimer ${t.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {tags.length === 0 && <p className="text-sm text-muted">Aucun tag.</p>}
        </div>

        <form onSubmit={onCreate} className="grid grid-cols-4 items-end gap-2 border-t border-border pt-4">
          <div className="col-span-2">
            <Label htmlFor="tag-name">Nom</Label>
            <Input id="tag-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="tag-scope">Portée</Label>
            <Select id="tag-scope" name="scope" defaultValue="CLIENT">
              <option value="CLIENT">Client</option>
              <option value="PROSPECT">Prospect</option>
              <option value="USER">Utilisateur</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="tag-color">Couleur</Label>
            <Input id="tag-color" name="color" type="color" defaultValue="#94a3b8" className="h-9 p-1" />
          </div>
          <div className="col-span-4 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
