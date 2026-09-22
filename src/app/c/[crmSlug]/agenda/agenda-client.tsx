"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, addWeeks, format, subDays, subMonths, subWeeks } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { listAppointmentsInRange, getClientOrProspectLabel } from "@/server/agenda/actions";
import { listTasksInRange } from "@/server/tasks/actions";
import { CalendarView, getRangeForView } from "./calendar-view";
import { AppointmentForm } from "./appointment-form";
import { AppointmentModal } from "./appointment-modal";
import type { AgendaAppointment, AgendaMember, AgendaTask, AgendaView } from "./types";

const VIEW_LABELS: Record<AgendaView, string> = { day: "Jour", week: "Semaine", month: "Mois" };

export function AgendaClient({
  crmId,
  crmSlug,
  currentUserId,
  members,
  canDelete,
  initialAppointmentId,
  initialNewForClientId,
  initialNewForProspectId,
}: {
  crmId: string;
  crmSlug: string;
  currentUserId: string;
  members: AgendaMember[];
  canDelete: boolean;
  initialAppointmentId?: string;
  initialNewForClientId?: string;
  initialNewForProspectId?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<AgendaView>("week");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [appointments, setAppointments] = useState<AgendaAppointment[]>([]);
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [loading, startTransition] = useTransition();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [createSlot, setCreateSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [createEntity, setCreateEntity] = useState<
    { type: "client" | "prospect"; id: string; label: string; phone: string | null; email: string | null } | undefined
  >(undefined);

  const range = useMemo(() => getRangeForView(view, anchorDate), [view, anchorDate]);

  const refresh = useCallback(() => {
    startTransition(async () => {
      const [apptList, taskList] = await Promise.all([
        listAppointmentsInRange(crmId, range.start.toISOString(), range.end.toISOString()),
        listTasksInRange(crmId, range.start.toISOString(), range.end.toISOString()),
      ]);
      setAppointments(apptList);
      setTasks(taskList);
    });
  }, [crmId, range.start, range.end]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useRealtimeChannel(`private-crm-${crmId}`, {
    "appointment.upserted": () => {
      refresh();
      router.refresh();
    },
    "appointment.deleted": () => {
      refresh();
      router.refresh();
    },
    "task.upserted": () => {
      refresh();
    },
  });

  // Prise en charge des conventions ?appointment=, ?newForClient=, ?newForProspect=
  useEffect(() => {
    if (initialAppointmentId) {
      setDetailId(initialAppointmentId);
    } else if (initialNewForClientId) {
      getClientOrProspectLabel(crmId, "client", initialNewForClientId).then((res) => {
        if (res) setCreateEntity({ type: "client", id: res.id, label: res.label, phone: res.phone, email: res.email });
        setCreateSlot({ start: new Date(), end: new Date(Date.now() + 30 * 60 * 1000) });
      });
    } else if (initialNewForProspectId) {
      getClientOrProspectLabel(crmId, "prospect", initialNewForProspectId).then((res) => {
        if (res) setCreateEntity({ type: "prospect", id: res.id, label: res.label, phone: res.phone, email: res.email });
        setCreateSlot({ start: new Date(), end: new Date(Date.now() + 30 * 60 * 1000) });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (ownerFilter === "all") return appointments;
    return appointments.filter((a) => a.ownerId === ownerFilter || a.participants.some((p) => p.userId === ownerFilter));
  }, [appointments, ownerFilter]);

  const filteredTasks = useMemo(() => {
    if (ownerFilter === "all") return tasks;
    return tasks.filter((t) => t.assignee.id === ownerFilter);
  }, [tasks, ownerFilter]);

  function navigate(direction: -1 | 1) {
    if (view === "day") setAnchorDate((d) => (direction === 1 ? addDays(d, 1) : subDays(d, 1)));
    else if (view === "week") setAnchorDate((d) => (direction === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    else setAnchorDate((d) => (direction === 1 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  const rangeLabel =
    view === "day"
      ? format(anchorDate, "EEEE d MMMM yyyy", { locale: fr })
      : view === "week"
        ? `${format(range.start, "d MMM", { locale: fr })} – ${format(range.end, "d MMM yyyy", { locale: fr })}`
        : format(anchorDate, "MMMM yyyy", { locale: fr });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => navigate(-1)} aria-label="Précédent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchorDate(new Date())}>
            Aujourd&apos;hui
          </Button>
          <Button size="icon" variant="outline" onClick={() => navigate(1)} aria-label="Suivant">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium capitalize text-text">{rangeLabel}</span>
          {loading && <span className="text-xs text-muted">Chargement...</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtre sans <label> visible (le design n'en prévoit pas) : le nom
              accessible passe donc par aria-label, sans rien afficher de plus. */}
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="w-32 sm:w-44"
            aria-label="Filtrer par commercial"
          >
            <option value="all">Tous les commerciaux</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["day", "week", "month"] as AgendaView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm ${view === v ? "bg-brand text-brand-fg" : "bg-surface text-text hover:bg-bg-subtle"}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setCreateEntity(undefined);
              setCreateSlot({ start: new Date(), end: new Date(Date.now() + 30 * 60 * 1000) });
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nouveau rendez-vous</span>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <CalendarView
          view={view}
          anchorDate={anchorDate}
          appointments={filtered}
          tasks={filteredTasks}
          onSelectAppointment={setDetailId}
          onSelectTask={(id) => router.push(`/c/${crmSlug}/tasks?task=${id}`)}
          onSelectSlot={(date) => {
            setCreateEntity(undefined);
            setCreateSlot({ start: date, end: new Date(date.getTime() + 30 * 60 * 1000) });
          }}
          onSelectDay={(date) => {
            setAnchorDate(date);
            setView("day");
          }}
        />
      </div>

      <Modal open={!!createSlot} onClose={() => setCreateSlot(null)} title="Nouveau rendez-vous" width="lg">
        {createSlot && (
          <AppointmentForm
            crmId={crmId}
            members={members}
            currentUserId={currentUserId}
            defaultStart={createSlot.start}
            defaultEnd={createSlot.end}
            initialEntity={createEntity}
            onCancel={() => setCreateSlot(null)}
            onSuccess={(id) => {
              setCreateSlot(null);
              refresh();
              setDetailId(id);
            }}
          />
        )}
      </Modal>

      <Modal open={!!detailId} onClose={() => setDetailId(null)} title="Rendez-vous" width="xl">
        {detailId && (
          <AppointmentModal
            crmId={crmId}
            crmSlug={crmSlug}
            appointmentId={detailId}
            currentUserId={currentUserId}
            canDelete={canDelete}
            members={members}
            onClose={() => setDetailId(null)}
            onChanged={refresh}
          />
        )}
      </Modal>
    </div>
  );
}
