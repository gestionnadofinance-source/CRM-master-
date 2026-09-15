"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createCustomField, deleteCustomField } from "@/server/settings/actions";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";

export interface CustomFieldRow {
  id: string;
  entityType: "CLIENT" | "PROSPECT";
  label: string;
  fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
  options: string[];
  required: boolean;
  order: number;
}

export function CustomFieldsSection({
  crmId,
  crmSlug,
  fields,
}: {
  crmId: string;
  crmSlug: string;
  fields: CustomFieldRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState("TEXT");
  const router = useRouter();

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("order", String(fields.length));
    setError(null);
    startTransition(async () => {
      const res = await createCustomField(crmId, crmSlug, fd);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else {
        (e.target as HTMLFormElement).reset();
        setFieldType("TEXT");
        router.refresh();
      }
    });
  }

  function onDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteCustomField(crmId, crmSlug, id);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Champs personnalisés</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(["CLIENT", "PROSPECT"] as const).map((entity) => (
          <div key={entity}>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              {entity === "CLIENT" ? "Clients" : "Prospects"}
            </p>
            <ul className="divide-y divide-border">
              {fields
                .filter((f) => f.entityType === entity)
                .map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-sm text-text">
                      {f.label}
                      <Badge variant="default">{f.fieldType}</Badge>
                      {f.required && <Badge variant="warning">Obligatoire</Badge>}
                      {f.options.length > 0 && <span className="text-xs text-muted">{f.options.join(", ")}</span>}
                    </div>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDelete(f.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </li>
                ))}
              {fields.filter((f) => f.entityType === entity).length === 0 && (
                <li className="py-2 text-sm text-muted">Aucun champ.</li>
              )}
            </ul>
          </div>
        ))}

        <form onSubmit={onCreate} className="grid grid-cols-6 items-end gap-2 border-t border-border pt-4">
          <div>
            <Label htmlFor="cf-entity">Entité</Label>
            <Select id="cf-entity" name="entityType" defaultValue="CLIENT">
              <option value="CLIENT">Client</option>
              <option value="PROSPECT">Prospect</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="cf-label">Libellé</Label>
            <Input id="cf-label" name="label" required />
          </div>
          <div>
            <Label htmlFor="cf-type">Type</Label>
            <Select id="cf-type" name="fieldType" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="TEXT">Texte</option>
              <option value="NUMBER">Nombre</option>
              <option value="DATE">Date</option>
              <option value="SELECT">Liste</option>
              <option value="BOOLEAN">Oui/Non</option>
            </Select>
          </div>
          {fieldType === "SELECT" && (
            <div>
              <Label htmlFor="cf-options">Options (séparées par des virgules)</Label>
              <Input id="cf-options" name="options" placeholder="A, B, C" />
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" name="required" className="h-3.5 w-3.5" /> Obligatoire
          </label>
          <div className="col-span-6 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="h-4 w-4" /> Ajouter le champ
            </Button>
          </div>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
