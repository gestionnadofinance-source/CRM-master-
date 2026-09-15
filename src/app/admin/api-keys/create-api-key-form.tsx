"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { createApiKey, type CreateApiKeyResult } from "@/server/admin/api-keys";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApiKeyPermission } from "@prisma/client";

export function CreateApiKeyForm({ onCreated }: { onCreated?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateApiKeyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [permission, setPermission] = useState<ApiKeyPermission>("READ_ONLY");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createApiKey(String(fd.get("name") ?? ""), permission);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setResult(res);
      onCreated?.();
    });
  }

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          <p className="font-medium">Clé créée avec succès.</p>
          <p className="mt-1">
            Copiez-la maintenant et renseignez-la dans votre intégration (ex. Obsidian) — elle ne sera plus jamais
            affichée. Si vous la perdez, révoquez cette clé et créez-en une nouvelle.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2">
          <code className="break-all text-sm font-semibold text-text">{result.key}</code>
          <button
            type="button"
            className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted hover:text-brand"
            onClick={() => {
              navigator.clipboard.writeText(result.key ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Nom de la clé *</Label>
        <Input id="name" name="name" required placeholder="Ex. Obsidian" />
        <p className="mt-1 text-xs text-muted">Sert à identifier l&apos;usage de la clé (aucun impact fonctionnel).</p>
      </div>

      <div>
        <Label>Permission *</Label>
        <div className="mt-1 space-y-2">
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors",
              permission === "READ_ONLY" ? "border-brand/50 bg-brand/5" : "border-border"
            )}
          >
            <input
              type="radio"
              name="permission"
              value="READ_ONLY"
              checked={permission === "READ_ONLY"}
              onChange={() => setPermission("READ_ONLY")}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block font-medium text-text">Lecture seule (recommandé)</span>
              <span className="block text-xs text-muted">
                La clé peut uniquement consulter les données. Aucune création, modification ou suppression possible.
              </span>
            </span>
          </label>
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors",
              permission === "READ_WRITE" ? "border-amber-500/50 bg-amber-500/5" : "border-border"
            )}
          >
            <input
              type="radio"
              name="permission"
              value="READ_WRITE"
              checked={permission === "READ_WRITE"}
              onChange={() => setPermission("READ_WRITE")}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block font-medium text-text">Lecture et écriture</span>
              <span className="block text-xs text-muted">
                La clé peut aussi créer, modifier et supprimer des données (clients, prospects, devis, tâches,
                rendez-vous, chantiers, pointages) sur tous les CRM, avec les mêmes effets que depuis
                l&apos;application. À réserver aux intégrations de confiance : une clé compromise permet de tout
                modifier.
              </span>
            </span>
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Création..." : "Créer la clé"}
        </Button>
      </div>
    </form>
  );
}
