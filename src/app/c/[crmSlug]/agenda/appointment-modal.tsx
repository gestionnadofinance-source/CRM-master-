"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { format as formatDateFns } from "date-fns";
import { Calendar, Clock, MapPin, Phone, Mail, User, Users, Trash2, Pencil } from "lucide-react";
import {
  getAppointmentDetail,
  updateAppointmentStatus,
  submitAppointmentReport,
  deleteAppointment,
} from "@/server/agenda/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { DocumentList } from "@/components/documents/document-list";
import { formatCurrency, formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import type { AppointmentStatus } from "@prisma/client";
import { AppointmentForm } from "./appointment-form";
import type { AgendaMember } from "./types";

type Detail = NonNullable<Awaited<ReturnType<typeof getAppointmentDetail>>>;

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Planifié",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

const STATUS_VARIANT: Record<AppointmentStatus, "brand" | "success" | "danger" | "warning"> = {
  SCHEDULED: "brand",
  COMPLETED: "success",
  CANCELLED: "danger",
  NO_SHOW: "warning",
};

export function AppointmentModal({
  crmId,
  crmSlug,
  appointmentId,
  currentUserId,
  canDelete,
  members,
  onClose,
  onChanged,
}: {
  crmId: string;
  crmSlug: string;
  appointmentId: string;
  currentUserId: string;
  canDelete: boolean;
  members: AgendaMember[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reportError, setReportError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const d = await getAppointmentDetail(crmId, appointmentId);
    setDetail(d);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  if (loading) return <p className="py-8 text-center text-sm text-muted">Chargement...</p>;
  if (!detail) return <p className="py-8 text-center text-sm text-muted">Rendez-vous introuvable.</p>;

  const { appointment, history, prep } = detail;

  if (editing) {
    return (
      <AppointmentForm
        crmId={crmId}
        members={members}
        currentUserId={currentUserId}
        initial={{
          id: appointment.id,
          title: appointment.title,
          clientId: appointment.clientId,
          prospectId: appointment.prospectId,
          entityLabel: appointment.client?.company ?? appointment.prospect?.company ?? null,
          ownerId: appointment.ownerId,
          participantIds: appointment.participants.map((p) => p.userId),
          startAt: new Date(appointment.startAt),
          endAt: new Date(appointment.endAt),
          location: appointment.location,
          phone: appointment.phone,
          email: appointment.email,
          notes: appointment.notes,
        }}
        onCancel={() => setEditing(false)}
        onSuccess={() => {
          setEditing(false);
          refresh();
          onChanged();
        }}
      />
    );
  }

  function changeStatus(status: AppointmentStatus) {
    startTransition(async () => {
      await updateAppointmentStatus(crmId, appointmentId, status);
      await refresh();
      onChanged();
    });
  }

  function submitReport(formData: FormData) {
    setReportError(null);
    startTransition(async () => {
      const res = await submitAppointmentReport(crmId, appointmentId, formData);
      if (!res.ok) {
        setReportError(res.error ?? "Erreur lors de l'enregistrement du compte rendu.");
        return;
      }
      await refresh();
      onChanged();
    });
  }

  function remove() {
    if (!confirm("Supprimer définitivement ce rendez-vous ?")) return;
    startTransition(async () => {
      await deleteAppointment(crmId, appointmentId);
      onChanged();
      onClose();
    });
  }

  const entityLink = appointment.clientId
    ? { href: `/c/${crmSlug}/clients/${appointment.clientId}`, label: appointment.client?.company ?? "Client" }
    : appointment.prospectId
      ? { href: `/c/${crmSlug}/prospects/${appointment.prospectId}`, label: appointment.prospect?.company ?? "Prospect" }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-text">{appointment.title}</h3>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
            {appointment.isPublicBooking && <Badge variant="default">Réservation en ligne</Badge>}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)} title="Modifier">
            <Pencil className="h-4 w-4" />
          </Button>
          {canDelete && (
            <Button size="icon" variant="ghost" onClick={remove} title="Supprimer" disabled={pending}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2 text-text">
          <Calendar className="h-4 w-4 text-muted" /> {formatDate(appointment.startAt)}
        </div>
        <div className="flex items-center gap-2 text-text">
          <Clock className="h-4 w-4 text-muted" />
          {formatDateFns(new Date(appointment.startAt), "HH:mm")} – {formatDateFns(new Date(appointment.endAt), "HH:mm")}
        </div>
        {appointment.location && (
          <div className="flex items-center gap-2 text-text">
            <MapPin className="h-4 w-4 text-muted" /> {appointment.location}
          </div>
        )}
        {appointment.phone && (
          <div className="flex items-center gap-2 text-text">
            <Phone className="h-4 w-4 text-muted" /> {appointment.phone}
          </div>
        )}
        {appointment.email && (
          <div className="flex items-center gap-2 text-text">
            <Mail className="h-4 w-4 text-muted" /> {appointment.email}
          </div>
        )}
        <div className="flex items-center gap-2 text-text">
          <User className="h-4 w-4 text-muted" />
          {appointment.owner.firstName} {appointment.owner.lastName}
        </div>
        {appointment.participants.length > 0 && (
          <div className="flex items-start gap-2 text-text">
            <Users className="mt-0.5 h-4 w-4 text-muted" />
            <span>{appointment.participants.map((p) => `${p.user.firstName} ${p.user.lastName}`).join(", ")}</span>
          </div>
        )}
      </div>

      {entityLink && (
        <Link href={entityLink.href} className="inline-block text-sm text-brand hover:underline">
          Voir la fiche {appointment.clientId ? "client" : "prospect"} : {entityLink.label}
        </Link>
      )}

      {appointment.notes && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
          <p className="whitespace-pre-wrap text-sm text-text">{appointment.notes}</p>
        </div>
      )}

      {appointment.isPublicBooking && (
        <div className="rounded-md border border-border bg-bg-subtle p-3 text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Demande initiale (réservation en ligne)</p>
          <p className="text-text">
            {appointment.bookingContactName} · {appointment.bookingContactEmail}
            {appointment.bookingContactPhone ? ` · ${appointment.bookingContactPhone}` : ""}
          </p>
          {appointment.bookingMessage && <p className="mt-1 text-muted">{appointment.bookingMessage}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {(["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"] as AppointmentStatus[])
          .filter((s) => s !== appointment.status)
          .map((s) => (
            <Button key={s} size="sm" variant="outline" disabled={pending} onClick={() => changeStatus(s)}>
              Marquer {STATUS_LABELS[s].toLowerCase()}
            </Button>
          ))}
      </div>

      {prep && (
        <div className="rounded-md border border-border p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Avant ce rendez-vous</p>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Dernier rendez-vous</dt>
              <dd className="text-text">
                {prep.lastAppointment ? `${prep.lastAppointment.title} · ${formatDate(prep.lastAppointment.startAt)}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Dernier devis</dt>
              <dd className="text-text">
                {prep.lastQuote ? `${prep.lastQuote.number} · ${formatCurrency(prep.lastQuote.totalTtc)}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Montant potentiel</dt>
              <dd className="text-text">{prep.potentialAmount != null ? formatCurrency(prep.potentialAmount) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Prochaine action</dt>
              <dd className="text-text">{prep.nextAction ?? "—"}</dd>
            </div>
          </dl>
          {prep.recentActivity.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-muted">Historique récent</p>
              <ul className="space-y-1 text-xs text-muted">
                {prep.recentActivity.map((log) => (
                  <li key={log.id}>
                    {log.user ? `${log.user.firstName} ${log.user.lastName}` : "Système"} · {log.action} ·{" "}
                    {formatDate(log.createdAt, true)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-border p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Compte rendu</p>
        <form
          action={submitReport}
          className="space-y-3"
          onSubmit={() => setReportError(null)}
        >
          <div>
            <Label htmlFor="reportSummary">Résumé</Label>
            <Textarea id="reportSummary" name="reportSummary" rows={2} defaultValue={appointment.reportSummary ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reportNeeds">Besoins identifiés</Label>
              <Textarea id="reportNeeds" name="reportNeeds" rows={2} defaultValue={appointment.reportNeeds ?? ""} />
            </div>
            <div>
              <Label htmlFor="reportBudget">Budget évoqué</Label>
              <Input id="reportBudget" name="reportBudget" defaultValue={appointment.reportBudget ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reportNextStep">Prochaine étape</Label>
              <Input id="reportNextStep" name="reportNextStep" defaultValue={appointment.reportNextStep ?? ""} />
            </div>
            <div>
              <Label htmlFor="reportFollowUpAt">Date de relance</Label>
              <Input
                id="reportFollowUpAt"
                name="reportFollowUpAt"
                type="date"
                defaultValue={appointment.reportFollowUpAt ? new Date(appointment.reportFollowUpAt).toISOString().slice(0, 10) : ""}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="reportNotes">Notes complémentaires</Label>
            <Textarea id="reportNotes" name="reportNotes" rows={2} defaultValue={appointment.reportNotes ?? ""} />
          </div>
          <label className="inline-flex items-center gap-1.5 text-sm text-text">
            <input type="checkbox" name="markCompleted" defaultChecked={appointment.status === "COMPLETED"} className="h-3.5 w-3.5" />
            Marquer ce rendez-vous comme terminé
          </label>
          {reportError && <p className="text-sm text-red-500">{reportError}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Enregistrement..." : "Enregistrer le compte rendu"}
            </Button>
          </div>
        </form>
      </div>

      <DocumentList crmId={crmId} entityType="APPOINTMENT" entityId={appointment.id} />

      {history.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Historique</p>
          <ul className="space-y-1.5 text-xs text-muted">
            {history.map((log) => (
              <li key={log.id}>
                {log.user ? `${log.user.firstName} ${log.user.lastName}` : "Système"} · {translateActivityAction(log.action)} ·{" "}
                {formatDate(log.createdAt, true)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
