"use client";

import { useState, useTransition } from "react";
import { createUser, type CreateUserResult } from "@/server/admin/actions";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CrmOption {
  id: string;
  name: string;
}

const COLORS = ["#3b6bf5", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

export function CreateUserForm({ crms, onCreated }: { crms: CrmOption[]; onCreated?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateUserResult | null>(null);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [selectedCrms, setSelectedCrms] = useState<Set<string>>(new Set());
  const [categoryByCrm, setCategoryByCrm] = useState<Record<string, "COMMERCIAL" | "OUVRIER" | "OUVRIER_FOREMAN" | "SECRETAIRE">>({});
  const [copied, setCopied] = useState(false);

  function toggleCrm(id: string) {
    setSelectedCrms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createUser(fd);
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
          <p className="font-medium">Utilisateur créé avec succès.</p>
          <p className="mt-1">
            Communiquez son identifiant (email) et le mot de passe temporaire ci-dessous à l&apos;utilisateur — il devra
            le changer à sa première connexion.
            {result.emailDelivered ? " Un email récapitulatif lui a aussi été envoyé." : ""}
          </p>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2">
          <code className="text-sm font-semibold text-text">{result.temporaryPassword}</code>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted hover:text-brand"
            onClick={() => {
              navigator.clipboard.writeText(result.temporaryPassword ?? "");
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">Prénom *</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div>
          <Label htmlFor="lastName">Nom *</Label>
          <Input id="lastName" name="lastName" required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="email">Email *</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="col-span-2">
          <Label>Couleur</Label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <label key={c}>
                <input type="radio" name="color" value={c} defaultChecked={c === COLORS[0]} className="peer sr-only" />
                <span
                  className="block h-7 w-7 cursor-pointer rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-brand"
                  style={{ backgroundColor: c }}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          name="isGlobalAdmin"
          checked={isGlobalAdmin}
          onChange={(e) => setIsGlobalAdmin(e.target.checked)}
          className="h-4 w-4"
        />
        Administrateur global (accès total à tous les CRM et à l&apos;administration)
      </label>

      {!isGlobalAdmin && (
        <div>
          <Label>Accès CRM</Label>
          <p className="mb-2 text-xs text-muted">
            Cochez au moins un CRM, puis choisissez pour chacun la catégorie d&apos;accès (Commercial : accès
            complet au CRM · Ouvrier : accès limité aux onglets Planning et Coffre-fort) et le rôle.
          </p>
          <div className="space-y-2">
            {crms.length === 0 && <p className="text-sm text-muted">Aucun CRM disponible.</p>}
            {crms.map((crm) => {
              const checked = selectedCrms.has(crm.id);
              return (
                <div
                  key={crm.id}
                  className={cn(
                    "rounded-md border p-3 transition-colors",
                    checked ? "border-brand/50 bg-brand/5" : "border-border"
                  )}
                >
                  <label className="flex items-center gap-2 text-sm font-medium text-text">
                    <input
                      type="checkbox"
                      name="crmAccess"
                      value={crm.id}
                      checked={checked}
                      onChange={() => toggleCrm(crm.id)}
                      className="h-4 w-4"
                    />
                    {crm.name}
                  </label>
                  {checked && (
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor={`category-${crm.id}`} className="text-xs">
                            Profil
                          </Label>
                          <Select
                            id={`category-${crm.id}`}
                            name={`category-${crm.id}`}
                            defaultValue="COMMERCIAL"
                            onChange={(e) =>
                              setCategoryByCrm((prev) => ({
                                ...prev,
                                [crm.id]: e.target.value as "COMMERCIAL" | "OUVRIER" | "OUVRIER_FOREMAN" | "SECRETAIRE",
                              }))
                            }
                          >
                            <option value="COMMERCIAL">Commercial</option>
                            <option value="OUVRIER">Ouvrier</option>
                            <option value="OUVRIER_FOREMAN">Ouvrier — Chef de chantier</option>
                            <option value="SECRETAIRE">Secrétaire</option>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`role-${crm.id}`} className="text-xs">
                            Rôle
                          </Label>
                          <Select id={`role-${crm.id}`} name={`role-${crm.id}`} defaultValue="USER">
                            <option value="USER">Utilisateur</option>
                            <option value="MANAGER">Responsable</option>
                          </Select>
                        </div>
                      </div>
                      {categoryByCrm[crm.id] === "SECRETAIRE" && (
                        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted">
                          Accès total à l&apos;administration du CRM (Tableau de bord, Utilisateurs, Planning,
                          Pointage, Coffre-fort, Activité), sans accès aux données commerciales.
                        </p>
                      )}
                      {(categoryByCrm[crm.id] === "OUVRIER" || categoryByCrm[crm.id] === "OUVRIER_FOREMAN") && (
                        <div className="rounded-md border border-dashed border-border p-2">
                          <p className="mb-1.5 text-xs text-muted">
                            Montants par défaut des primes de pointage (modifiables ensuite par semaine).
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label htmlFor={`hourlyRate-${crm.id}`} className="text-[11px]">
                                Taux horaire (€)
                              </Label>
                              <Input id={`hourlyRate-${crm.id}`} name={`hourlyRate-${crm.id}`} type="number" min={0} step={0.1} defaultValue={0} className="h-8" />
                            </div>
                            <div>
                              <Label htmlFor={`housing-${crm.id}`} className="text-[11px]">
                                Logement (€)
                              </Label>
                              <Input id={`housing-${crm.id}`} name={`housing-${crm.id}`} type="number" min={0} step={0.5} defaultValue={0} className="h-8" />
                            </div>
                            <div>
                              <Label htmlFor={`dirt-${crm.id}`} className="text-[11px]">
                                Salissure (€)
                              </Label>
                              <Input id={`dirt-${crm.id}`} name={`dirt-${crm.id}`} type="number" min={0} step={0.5} defaultValue={5} className="h-8" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Création..." : "Créer l'utilisateur"}
        </Button>
      </div>
    </form>
  );
}
