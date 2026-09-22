"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserAccess } from "@/server/admin/actions";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CrmOption {
  id: string;
  name: string;
}

export function EditAccessForm({
  userId,
  firstName,
  lastName,
  isGlobalAdmin: initialIsGlobalAdmin,
  crms,
  initialAccess,
  isSelf,
}: {
  userId: string;
  firstName: string;
  lastName: string;
  isGlobalAdmin: boolean;
  crms: CrmOption[];
  initialAccess: {
    crmId: string;
    role: "MANAGER" | "USER";
    category: "COMMERCIAL" | "OUVRIER" | "SECRETAIRE";
    isForeman: boolean;
    defaultHourlyRate: number;
    defaultHousingAllowance: number;
    defaultDirtAllowance: number;
  }[];
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(initialIsGlobalAdmin);
  const [selectedCrms, setSelectedCrms] = useState<Set<string>>(new Set(initialAccess.map((a) => a.crmId)));
  const [categoryByCrm, setCategoryByCrm] = useState<Record<string, "COMMERCIAL" | "OUVRIER" | "OUVRIER_FOREMAN" | "SECRETAIRE">>(
    Object.fromEntries(
      initialAccess.map((a) => [a.crmId, a.category === "OUVRIER" && a.isForeman ? "OUVRIER_FOREMAN" : a.category])
    )
  );
  const router = useRouter();

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
    setSuccess(false);
    startTransition(async () => {
      const res = await updateUserAccess(userId, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">Prénom</Label>
          <Input id="firstName" name="firstName" defaultValue={firstName} required />
        </div>
        <div>
          <Label htmlFor="lastName">Nom</Label>
          <Input id="lastName" name="lastName" defaultValue={lastName} required />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          name="isGlobalAdmin"
          checked={isGlobalAdmin}
          disabled={isSelf}
          onChange={(e) => setIsGlobalAdmin(e.target.checked)}
          className="h-4 w-4"
        />
        Administrateur global
        {isSelf && <span className="text-xs text-muted">(non modifiable sur votre propre compte)</span>}
      </label>

      {!isGlobalAdmin && (
        <div>
          <Label>Accès CRM</Label>
          <p className="mb-2 text-xs text-muted">
            Cochez au moins un CRM, puis choisissez pour chacun la catégorie d&apos;accès (Commercial : accès
            complet au CRM · Ouvrier : accès limité aux onglets Planning et Coffre-fort) et le rôle. Les accès
            révoqués ou modifiés prennent effet immédiatement.
          </p>
          <div className="space-y-2">
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
                            defaultValue={categoryByCrm[crm.id] ?? "COMMERCIAL"}
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
                          <Select
                            id={`role-${crm.id}`}
                            name={`role-${crm.id}`}
                            defaultValue={initialAccess.find((a) => a.crmId === crm.id)?.role ?? "USER"}
                          >
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
                      {(categoryByCrm[crm.id] === "OUVRIER" || categoryByCrm[crm.id] === "OUVRIER_FOREMAN") &&
                        (() => {
                          const existing = initialAccess.find((a) => a.crmId === crm.id);
                          return (
                            <div className="rounded-md border border-dashed border-border p-2">
                              <p className="mb-1.5 text-xs text-muted">
                                Montants par défaut des primes de pointage (modifiables ensuite par semaine).
                              </p>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <Label htmlFor={`hourlyRate-${crm.id}`} className="text-[11px]">
                                    Taux horaire (€)
                                  </Label>
                                  <Input
                                    id={`hourlyRate-${crm.id}`}
                                    name={`hourlyRate-${crm.id}`}
                                    type="number"
                                    min={0}
                                    step={0.1}
                                    defaultValue={existing?.defaultHourlyRate ?? 0}
                                    className="h-8"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor={`housing-${crm.id}`} className="text-[11px]">
                                    Logement (€)
                                  </Label>
                                  <Input
                                    id={`housing-${crm.id}`}
                                    name={`housing-${crm.id}`}
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    defaultValue={existing?.defaultHousingAllowance ?? 0}
                                    className="h-8"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor={`dirt-${crm.id}`} className="text-[11px]">
                                    Salissure (€)
                                  </Label>
                                  <Input
                                    id={`dirt-${crm.id}`}
                                    name={`dirt-${crm.id}`}
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    defaultValue={existing?.defaultDirtAllowance ?? 5}
                                    className="h-8"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-emerald-700 dark:text-emerald-400">Modifications enregistrées.</p>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
