"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { format } from "date-fns";
import { createAppointment, updateAppointment, searchClientsAndProspects } from "@/server/agenda/actions";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AgendaMember } from "./types";

function toLocalInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export interface AppointmentFormInitial {
  id: string;
  title: string;
  clientId: string | null;
  prospectId: string | null;
  entityLabel: string | null;
  ownerId: string;
  participantIds: string[];
  startAt: Date;
  endAt: Date;
  location: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export function AppointmentForm({
  crmId,
  members,
  currentUserId,
  initial,
  defaultStart,
  defaultEnd,
  initialEntity,
  onSuccess,
  onCancel,
}: {
  crmId: string;
  members: AgendaMember[];
  currentUserId: string;
  initial?: AppointmentFormInitial;
  defaultStart?: Date;
  defaultEnd?: Date;
  initialEntity?: { type: "client" | "prospect"; id: string; label: string; phone: string | null; email: string | null };
  onSuccess: (appointmentId: string) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialType: "none" | "client" | "prospect" = initial?.clientId
    ? "client"
    : initial?.prospectId
      ? "prospect"
      : initialEntity
        ? initialEntity.type
        : "none";
  const initialId = initial?.clientId ?? initial?.prospectId ?? initialEntity?.id ?? "";
  const initialLabel = initial?.entityLabel ?? initialEntity?.label ?? "";

  const [entityType, setEntityType] = useState<"none" | "client" | "prospect">(initialType);
  const [entityId, setEntityId] = useState(initialId);
  const [entityQuery, setEntityQuery] = useState(initialLabel);
  const [entityResults, setEntityResults] = useState<{ type: "client" | "prospect"; id: string; label: string }[]>([]);
  const [entityOpen, setEntityOpen] = useState(false);

  useEffect(() => {
    if (!entityOpen || entityQuery.trim().length < 2) {
      setEntityResults([]);
      return;
    }
    const handle = setTimeout(() => {
      searchClientsAndProspects(crmId, entityQuery).then(setEntityResults);
    }, 250);
    return () => clearTimeout(handle);
  }, [entityQuery, entityOpen, crmId]);

  const start = defaultStart ?? initial?.startAt ?? new Date();
  const end = defaultEnd ?? initial?.endAt ?? new Date(start.getTime() + 30 * 60 * 1000);

  // Le rendez-vous est toujours porté par un commercial : ni un admin, ni un
  // ouvrier/chef de chantier ne peut être désigné comme "Commercial" du RDV.
  const commercialMembers = members.filter((m) => m.category === "COMMERCIAL");
  // Les participants additionnels peuvent inclure des admins (ex : pour
  // superviser un rendez-vous important), mais jamais un ouvrier/chef de
  // chantier, qui n'a rien à faire sur un rendez-vous commercial.
  const participantCandidates = members.filter((m) => m.isGlobalAdmin || m.category === "COMMERCIAL");

  const [startAtValue, setStartAtValue] = useState(toLocalInputValue(start));
  const [endAtValue, setEndAtValue] = useState(toLocalInputValue(end));

  function handleStartAtChange(value: string) {
    setStartAtValue(value);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setEndAtValue(toLocalInputValue(new Date(parsed.getTime() + 60 * 60 * 1000)));
    }
  }

  function submit() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("clientId", entityType === "client" ? entityId : "");
    fd.set("prospectId", entityType === "prospect" ? entityId : "");
    setError(null);
    startTransition(async () => {
      const res = initial ? await updateAppointment(crmId, initial.id, fd) : await createAppointment(crmId, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      if (res.appointmentId) onSuccess(res.appointmentId);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="title">Titre *</Label>
        <Input id="title" name="title" required defaultValue={initial?.title ?? ""} placeholder="Ex : Visite technique" />
      </div>

      <div className="relative">
        <Label>Client ou prospect</Label>
        <div className="flex gap-2">
          <Select
            className="w-32 shrink-0"
            value={entityType}
            onChange={(e) => {
              const v = e.target.value as "none" | "client" | "prospect";
              setEntityType(v);
              if (v === "none") {
                setEntityId("");
                setEntityQuery("");
              }
            }}
          >
            <option value="none">Aucun</option>
            <option value="client">Client</option>
            <option value="prospect">Prospect</option>
          </Select>
          {entityType !== "none" && (
            <Input
              placeholder="Rechercher par nom d'entreprise..."
              value={entityQuery}
              onChange={(e) => {
                setEntityQuery(e.target.value);
                setEntityId("");
                setEntityOpen(true);
              }}
              onFocus={() => setEntityOpen(true)}
              onBlur={() => setTimeout(() => setEntityOpen(false), 150)}
            />
          )}
        </div>
        {entityOpen && entityResults.filter((r) => r.type === entityType).length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
            {entityResults
              .filter((r) => r.type === entityType)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-bg-subtle"
                    onClick={() => {
                      setEntityId(r.id);
                      setEntityQuery(r.label);
                      setEntityOpen(false);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
          </ul>
        )}
        {entityType !== "none" && !entityId && entityQuery.trim().length >= 2 && !entityOpen && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Sélectionnez un élément dans la liste.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="startAt">Début *</Label>
          <Input
            id="startAt"
            name="startAt"
            type="datetime-local"
            required
            value={startAtValue}
            onChange={(e) => handleStartAtChange(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="endAt">Fin *</Label>
          <Input
            id="endAt"
            name="endAt"
            type="datetime-local"
            required
            value={endAtValue}
            onChange={(e) => setEndAtValue(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ownerId">Commercial *</Label>
          <Select id="ownerId" name="ownerId" required defaultValue={initial?.ownerId ?? currentUserId}>
            {commercialMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="location">Lieu</Label>
          <Input id="location" name="location" defaultValue={initial?.location ?? ""} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="phone">Téléphone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={initial?.phone ?? initialEntity?.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={initial?.email ?? initialEntity?.email ?? ""} />
        </div>
      </div>

      {participantCandidates.length > 1 && (
        <div>
          <Label>Participants additionnels</Label>
          <div className="flex flex-wrap gap-2">
            {participantCandidates.map((m) => (
              <label
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-text has-[:checked]:border-brand has-[:checked]:bg-brand/10"
              >
                <input
                  type="checkbox"
                  name="participantIds"
                  value={m.id}
                  defaultChecked={initial?.participantIds?.includes(m.id)}
                  className="h-3 w-3"
                />
                {m.firstName} {m.lastName}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={initial?.notes ?? ""} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : initial ? "Enregistrer" : "Créer le rendez-vous"}
        </Button>
      </div>
    </form>
  );
}
