"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createQuoteTemplate, deleteQuoteTemplate } from "@/server/settings/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";

export interface QuoteTemplateRow {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  mentions: string | null;
  conditions: string | null;
  footer: string | null;
  isDefault: boolean;
}

export function QuoteTemplatesSection({
  crmId,
  crmSlug,
  templates,
}: {
  crmId: string;
  crmSlug: string;
  templates: QuoteTemplateRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createQuoteTemplate(crmId, crmSlug, fd);
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
      const res = await deleteQuoteTemplate(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modèles de devis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-sm text-text">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.primaryColor }} />
                {t.name}
                {t.isDefault && <Badge variant="brand">Par défaut</Badge>}
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(t.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
          {templates.length === 0 && <li className="py-2 text-sm text-muted">Aucun modèle.</li>}
        </ul>

        <form onSubmit={onCreate} className="space-y-3 border-t border-border pt-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="qt-name">Nom</Label>
              <Input id="qt-name" name="name" required />
            </div>
            <div>
              <Label htmlFor="qt-color">Couleur</Label>
              <Input id="qt-color" name="primaryColor" type="color" defaultValue="#3b6bf5" className="h-9 p-1" />
            </div>
            <div className="col-span-3">
              <Label htmlFor="qt-logo">URL du logo</Label>
              <Input id="qt-logo" name="logoUrl" placeholder="https://..." />
            </div>
            <div className="col-span-3">
              <Label htmlFor="qt-mentions">Mentions</Label>
              <Textarea id="qt-mentions" name="mentions" rows={2} />
            </div>
            <div className="col-span-3">
              <Label htmlFor="qt-conditions">Conditions</Label>
              <Textarea id="qt-conditions" name="conditions" rows={2} />
            </div>
            <div className="col-span-3">
              <Label htmlFor="qt-footer">Pied de page</Label>
              <Textarea id="qt-footer" name="footer" rows={2} />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" name="isDefault" className="h-3.5 w-3.5" /> Modèle par défaut
          </label>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="h-4 w-4" /> Ajouter le modèle
            </Button>
          </div>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
