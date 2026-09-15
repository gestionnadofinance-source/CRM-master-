"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createProspect, updateProspect, type ProspectActionResult } from "@/server/prospects/actions";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProspectStatus } from "@prisma/client";

interface Option {
  id: string;
  name: string;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ProspectFormInitial {
  id: string;
  company: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  siret: string | null;
  sector: string | null;
  activity: string | null;
  size: string | null;
  sourceId: string | null;
  ownerId: string;
  status: ProspectStatus;
  potentialAmount: number | null;
  notes: string | null;
  tagIds: string[];
  lastContactAt: string | null;
  nextContactAt: string | null;
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  HOT: "Chaud",
  COLD: "Froid",
  TO_FOLLOW_UP: "À relancer",
  CONVERTED: "Converti",
  LOST: "Perdu",
};

export function ProspectForm({
  crmId,
  crmSlug,
  sources,
  tags,
  members,
  currentUserId,
  prospect,
  onSuccess,
}: {
  crmId: string;
  crmSlug: string;
  sources: Option[];
  tags: Option[];
  members: Member[];
  currentUserId: string;
  prospect?: ProspectFormInitial;
  onSuccess?: (prospectId: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; company: string } | null>(null);

  function submit(confirmDuplicate: boolean) {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    if (confirmDuplicate) fd.set("confirmDuplicate", "true");
    setError(null);
    startTransition(async () => {
      const res: ProspectActionResult = prospect
        ? await updateProspect(crmId, prospect.id, fd)
        : await createProspect(crmId, fd);
      if (res.duplicate) {
        setDuplicate(res.duplicate);
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      setDuplicate(null);
      if (res.prospectId) onSuccess?.(res.prospectId);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="company">Entreprise *</Label>
          <Input id="company" name="company" required defaultValue={prospect?.company} />
        </div>
        <div>
          <Label htmlFor="firstName">Prénom</Label>
          <Input id="firstName" name="firstName" defaultValue={prospect?.firstName ?? ""} />
        </div>
        <div>
          <Label htmlFor="lastName">Nom</Label>
          <Input id="lastName" name="lastName" defaultValue={prospect?.lastName ?? ""} />
        </div>
        <div>
          <Label htmlFor="phone">Téléphone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={prospect?.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={prospect?.email ?? ""} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="address">Adresse</Label>
          <Input id="address" name="address" defaultValue={prospect?.address ?? ""} />
        </div>
        <div>
          <Label htmlFor="sector">Secteur</Label>
          <Input id="sector" name="sector" defaultValue={prospect?.sector ?? ""} />
        </div>
        <div>
          <Label htmlFor="activity">Activité</Label>
          <Input id="activity" name="activity" defaultValue={prospect?.activity ?? ""} />
        </div>
        <div>
          <Label htmlFor="size">Taille</Label>
          <Input id="size" name="size" defaultValue={prospect?.size ?? ""} />
        </div>
        <div>
          <Label htmlFor="siret">SIRET</Label>
          <Input id="siret" name="siret" placeholder="14 chiffres" defaultValue={prospect?.siret ?? ""} />
        </div>
        <div>
          <Label htmlFor="sourceId">Source</Label>
          <Select id="sourceId" name="sourceId" defaultValue={prospect?.sourceId ?? ""}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ownerId">Commercial *</Label>
          <Select id="ownerId" name="ownerId" required defaultValue={prospect?.ownerId ?? currentUserId}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Statut</Label>
          <Select id="status" name="status" defaultValue={prospect?.status ?? "TO_FOLLOW_UP"}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="potentialAmount">Montant potentiel (€)</Label>
          <Input
            id="potentialAmount"
            name="potentialAmount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={prospect?.potentialAmount ?? ""}
          />
        </div>
        {prospect && (
          <>
            <div>
              <Label htmlFor="lastContactAt">Dernier contact</Label>
              <Input id="lastContactAt" name="lastContactAt" type="date" defaultValue={prospect.lastContactAt ?? ""} />
            </div>
            <div>
              <Label htmlFor="nextContactAt">Prochaine relance</Label>
              <Input id="nextContactAt" name="nextContactAt" type="date" defaultValue={prospect.nextContactAt ?? ""} />
            </div>
          </>
        )}
        <div className="col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={3} defaultValue={prospect?.notes ?? ""} />
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <label
                key={t.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-text has-[:checked]:border-brand has-[:checked]:bg-brand/10"
              >
                <input
                  type="checkbox"
                  name="tagIds"
                  value={t.id}
                  defaultChecked={prospect?.tagIds?.includes(t.id)}
                  className="h-3 w-3"
                />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {duplicate && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <p>
            Un prospect avec ce SIRET existe déjà :{" "}
            <Link href={`/c/${crmSlug}/prospects/${duplicate.id}`} className="underline" target="_blank">
              {duplicate.company}
            </Link>
          </p>
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => submit(true)}>
              Créer quand même
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : prospect ? "Enregistrer" : "Créer le prospect"}
        </Button>
      </div>
    </form>
  );
}
