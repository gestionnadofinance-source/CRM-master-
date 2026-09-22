"use client";

import { useEffect, useState, useTransition } from "react";
import { Trash2, Plus, Copy, Check, Share2 } from "lucide-react";
import {
  listAvailabilityRules,
  listAvailabilityExceptions,
  addAvailabilityRule,
  deleteAvailabilityRule,
  addAvailabilityException,
  deleteAvailabilityException,
  listPublicBookingAppointments,
} from "@/server/availability/actions";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import type { AvailabilityExceptionType } from "@prisma/client";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
}

type Rule = Awaited<ReturnType<typeof listAvailabilityRules>>[number];
type Exception = Awaited<ReturnType<typeof listAvailabilityExceptions>>[number];
type PublicAppointment = Awaited<ReturnType<typeof listPublicBookingAppointments>>[number];

const WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const EXCEPTION_TYPE_LABELS: Record<AvailabilityExceptionType, string> = {
  LEAVE: "Congé",
  HOLIDAY: "Jour férié",
  UNAVAILABLE: "Indisponibilité",
  BLOCKED: "Créneau bloqué",
};

export function AvailabilityClient({
  crmId,
  currentUserId,
  members,
  initialRules,
  initialExceptions,
  publicAppointments,
  publicSlug,
  publicBookingEnabled,
}: {
  crmId: string;
  currentUserId: string;
  members: Member[];
  initialRules: Rule[];
  initialExceptions: Exception[];
  publicAppointments: PublicAppointment[];
  publicSlug: string | null;
  publicBookingEnabled: boolean;
}) {
  const [targetUserId, setTargetUserId] = useState(currentUserId);
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [exceptions, setExceptions] = useState<Exception[]>(initialExceptions);
  const [loading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (publicSlug && typeof window !== "undefined") {
      setBookingUrl(`${window.location.origin}/book/${publicSlug}`);
    }
  }, [publicSlug]);

  async function copyBookingLink() {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Impossible de copier le lien automatiquement. Sélectionnez-le manuellement.");
    }
  }

  async function shareBookingLink() {
    if (!bookingUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Prendre rendez-vous", url: bookingUrl });
      } catch {
        // L'utilisateur a annulé le partage — rien à faire.
      }
    } else {
      await copyBookingLink();
    }
  }

  useEffect(() => {
    if (targetUserId === currentUserId) {
      setRules(initialRules);
      setExceptions(initialExceptions);
      return;
    }
    startTransition(async () => {
      const [r, e] = await Promise.all([
        listAvailabilityRules(crmId, targetUserId),
        listAvailabilityExceptions(crmId, targetUserId),
      ]);
      setRules(r);
      setExceptions(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId]);

  async function refreshTarget() {
    const [r, e] = await Promise.all([
      listAvailabilityRules(crmId, targetUserId),
      listAvailabilityExceptions(crmId, targetUserId),
    ]);
    setRules(r);
    setExceptions(e);
  }

  function handleAddRule(weekday: number, startTime: string, endTime: string) {
    setError(null);
    const fd = new FormData();
    fd.set("userId", targetUserId);
    fd.set("weekday", String(weekday));
    fd.set("startTime", startTime);
    fd.set("endTime", endTime);
    startTransition(async () => {
      const res = await addAvailabilityRule(crmId, fd);
      if (!res.ok) {
        setError(res.error ?? "Erreur.");
        return;
      }
      await refreshTarget();
    });
  }

  function handleDeleteRule(ruleId: string) {
    startTransition(async () => {
      await deleteAvailabilityRule(crmId, ruleId);
      await refreshTarget();
    });
  }

  function handleAddException(formData: FormData) {
    setError(null);
    formData.set("userId", targetUserId);
    startTransition(async () => {
      const res = await addAvailabilityException(crmId, formData);
      if (!res.ok) {
        setError(res.error ?? "Erreur.");
        return;
      }
      await refreshTarget();
    });
  }

  function handleDeleteException(exceptionId: string) {
    startTransition(async () => {
      await deleteAvailabilityException(crmId, exceptionId);
      await refreshTarget();
    });
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="targetUser" className="!mb-0">
            Gérer la disponibilité de
          </Label>
          <Select id="targetUser" value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} className="w-56">
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === currentUserId ? `${m.firstName} ${m.lastName} (moi)` : `${m.firstName} ${m.lastName}`}
              </option>
            ))}
          </Select>
          {loading && <span className="text-xs text-muted">Chargement...</span>}
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lien de réservation en ligne</CardTitle>
        </CardHeader>
        <CardContent>
          {!publicSlug ? (
            <p className="text-sm text-muted">La réservation en ligne n&apos;est pas encore configurée pour ce CRM.</p>
          ) : (
            <div className="space-y-2">
              {!publicBookingEnabled && (
                <p className="text-xs text-amber-800 dark:text-amber-400">
                  La réservation en ligne est actuellement désactivée : ce lien ne sera pas utilisable par vos clients tant qu&apos;elle
                  n&apos;est pas réactivée.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input readOnly value={bookingUrl ?? `/book/${publicSlug}`} onFocus={(e) => e.target.select()} className="min-w-[240px] flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={copyBookingLink} disabled={!bookingUrl}>
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copié !" : "Copier le lien"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={shareBookingLink} disabled={!bookingUrl}>
                  <Share2 className="h-4 w-4" />
                  Partager
                </Button>
              </div>
              <p className="text-xs text-muted">
                Envoyez ce lien à un client pour qu&apos;il choisisse lui-même un créneau selon vos disponibilités.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Créneaux hebdomadaires récurrents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WEEKDAY_LABELS.map((label, weekday) => (
              <WeekdayColumn
                key={weekday}
                label={label}
                weekday={weekday}
                rules={rules.filter((r) => r.weekday === weekday)}
                onAdd={handleAddRule}
                onDelete={handleDeleteRule}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Congés, jours fériés & indisponibilités</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ExceptionForm onSubmit={handleAddException} />
          <ul className="divide-y divide-border rounded-md border border-border">
            {exceptions.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">Aucune exception définie.</li>}
            {exceptions.map((ex) => (
              <li key={ex.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">{EXCEPTION_TYPE_LABELS[ex.type]}</Badge>
                    <span className="text-sm text-text">
                      {ex.allDay
                        ? `${formatDate(ex.startAt)}${formatDate(ex.startAt) !== formatDate(ex.endAt) ? ` → ${formatDate(ex.endAt)}` : ""}`
                        : `${formatDate(ex.startAt, true)} → ${formatDate(ex.endAt, true)}`}
                    </span>
                  </div>
                  {ex.reason && <p className="mt-0.5 truncate text-xs text-muted">{ex.reason}</p>}
                </div>
                <button onClick={() => handleDeleteException(ex.id)} className="shrink-0 text-muted hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rendez-vous issus de la réservation en ligne</CardTitle>
        </CardHeader>
        <CardContent>
          {publicAppointments.length === 0 ? (
            <p className="text-sm text-muted">Aucune réservation en ligne pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {publicAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-text">{a.bookingContactName ?? a.title}</span>{" "}
                    <span className="text-muted">
                      · {a.owner.firstName} {a.owner.lastName}
                    </span>
                  </div>
                  <span className="text-xs text-muted">{formatDate(a.startAt, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WeekdayColumn({
  label,
  weekday,
  rules,
  onAdd,
  onDelete,
}: {
  label: string;
  weekday: number;
  rules: Rule[];
  onAdd: (weekday: number, startTime: string, endTime: string) => void;
  onDelete: (ruleId: string) => void;
}) {
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");

  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium text-text">{label}</p>
      <ul className="mb-2 space-y-1">
        {rules
          .slice()
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded bg-bg-subtle px-2 py-1 text-xs">
              <span className="text-text">
                {r.startTime} – {r.endTime}
              </span>
              <button onClick={() => onDelete(r.id)} className="text-muted hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        {rules.length === 0 && <li className="text-xs text-muted">Aucun créneau.</li>}
      </ul>
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-text"
        />
        <span className="text-xs text-muted">–</span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-text"
        />
        <button
          onClick={() => onAdd(weekday, startTime, endTime)}
          className="shrink-0 rounded bg-brand p-1.5 text-brand-fg hover:opacity-90"
          title="Ajouter ce créneau"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ExceptionForm({ onSubmit }: { onSubmit: (formData: FormData) => void }) {
  const [allDay, setAllDay] = useState(true);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
        e.currentTarget.reset();
        setAllDay(true);
      }}
      className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-5"
    >
      <div>
        <Label htmlFor="excType" className="text-xs">
          Type
        </Label>
        <Select id="excType" name="type" defaultValue="UNAVAILABLE">
          <option value="LEAVE">Congé</option>
          <option value="HOLIDAY">Jour férié</option>
          <option value="UNAVAILABLE">Indisponibilité</option>
          <option value="BLOCKED">Créneau bloqué</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="excStart" className="text-xs">
          Début
        </Label>
        <Input id="excStart" name="startAt" type={allDay ? "date" : "datetime-local"} required />
      </div>
      <div>
        <Label htmlFor="excEnd" className="text-xs">
          Fin
        </Label>
        <Input id="excEnd" name="endAt" type={allDay ? "date" : "datetime-local"} required />
      </div>
      <div>
        <Label htmlFor="excReason" className="text-xs">
          Motif
        </Label>
        <Input id="excReason" name="reason" placeholder="Optionnel" />
      </div>
      <div className="flex items-end gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text">
          <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-3.5 w-3.5" />
          Journée entière
        </label>
        <Button type="submit" size="sm">
          Ajouter
        </Button>
      </div>
    </form>
  );
}
