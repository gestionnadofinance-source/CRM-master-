"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createEmailTemplate, deleteEmailTemplate } from "@/server/settings/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface EmailTemplateRow {
  id: string;
  key: string;
  name: string;
  subject: string;
  body: string;
}

const AVAILABLE_VARIABLES = [
  "{{prenom}}",
  "{{nom}}",
  "{{entreprise}}",
  "{{commercial}}",
  "{{date_rendez_vous}}",
  "{{numero_devis}}",
  "{{montant_devis}}",
];

export function EmailTemplatesSection({
  crmId,
  crmSlug,
  templates,
}: {
  crmId: string;
  crmSlug: string;
  templates: EmailTemplateRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createEmailTemplate(crmId, crmSlug, fd);
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
      const res = await deleteEmailTemplate(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modèles d&apos;emails</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted">
          Variables disponibles : {AVAILABLE_VARIABLES.map((v) => (
            <code key={v} className="mx-0.5 rounded bg-bg-subtle px-1 py-0.5">
              {v}
            </code>
          ))}
        </p>

        <ul className="divide-y divide-border">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <div className="text-sm text-text">
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-xs text-muted">({t.key})</span>
                <p className="text-xs text-muted">{t.subject}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(t.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
          {templates.length === 0 && <li className="py-2 text-sm text-muted">Aucun modèle.</li>}
        </ul>

        <form onSubmit={onCreate} className="space-y-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="et-key">Clé technique</Label>
              <Input id="et-key" name="key" required placeholder="ex: relance_devis" />
            </div>
            <div>
              <Label htmlFor="et-name">Nom</Label>
              <Input id="et-name" name="name" required />
            </div>
            <div className="col-span-2">
              <Label htmlFor="et-subject">Objet</Label>
              <Input id="et-subject" name="subject" required />
            </div>
            <div className="col-span-2">
              <Label htmlFor="et-body">Corps</Label>
              <Textarea id="et-body" name="body" rows={5} required />
            </div>
          </div>
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
