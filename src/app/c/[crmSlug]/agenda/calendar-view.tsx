"use client";

import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  format,
  set,
} from "date-fns";
import { fr } from "date-fns/locale";
import { CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgendaAppointment, AgendaTask, AgendaView } from "./types";

const HOUR_HEIGHT = 56;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 20;

export function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function hourBounds(appointments: AgendaAppointment[], tasks: AgendaTask[]): { start: number; end: number } {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const a of appointments) {
    const s = toDate(a.startAt);
    const e = toDate(a.endAt);
    start = Math.min(start, s.getHours());
    end = Math.max(end, e.getMinutes() > 0 ? e.getHours() + 1 : e.getHours());
  }
  for (const t of tasks) {
    if (!t.dueAt) continue;
    const d = toDate(t.dueAt);
    start = Math.min(start, d.getHours());
    end = Math.max(end, d.getHours() + 1);
  }
  return { start, end };
}

function statusDotClass(status: AgendaAppointment["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-500";
    case "CANCELLED":
      return "bg-red-500";
    case "NO_SHOW":
      return "bg-amber-500";
    default:
      return "bg-brand";
  }
}

function AppointmentBlock({
  appt,
  top,
  height,
  onSelect,
}: {
  appt: AgendaAppointment;
  top: number;
  height: number;
  onSelect: (id: string) => void;
}) {
  const color = appt.owner.color || "#3b6bf5";
  const who = appt.client?.company ?? appt.prospect?.company ?? appt.bookingContactName ?? "";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(appt.id);
      }}
      className={cn(
        "absolute left-1 right-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm transition-opacity hover:opacity-90",
        appt.status === "CANCELLED" && "opacity-50 line-through"
      )}
      style={{ top, height, backgroundColor: `${color}1f`, borderLeftColor: color }}
    >
      <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", statusDotClass(appt.status))} />
      <span className="font-medium text-text">{appt.title}</span>
      {who && <div className="truncate text-muted">{who}</div>}
    </button>
  );
}

function TaskBlock({ task, top, onSelect }: { task: AgendaTask; top: number; onSelect: (id: string) => void }) {
  const color = task.assignee.color || "#a855f7";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(task.id);
      }}
      className={cn(
        "absolute left-1 right-1 z-10 flex items-center gap-1 overflow-hidden rounded-md border-l-4 border-dashed px-2 py-0.5 text-left text-xs shadow-sm transition-opacity hover:opacity-90",
        task.status === "DONE" && "opacity-50 line-through"
      )}
      style={{ top, height: 20, backgroundColor: `${color}1f`, borderLeftColor: color }}
    >
      <CheckSquare className="h-3 w-3 shrink-0" style={{ color }} />
      <span className="truncate font-medium text-text">{task.title}</span>
    </button>
  );
}

function TimeGrid({
  days,
  appointments,
  tasks,
  onSelectAppointment,
  onSelectTask,
  onSelectSlot,
}: {
  days: Date[];
  appointments: AgendaAppointment[];
  tasks: AgendaTask[];
  onSelectAppointment: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectSlot: (date: Date) => void;
}) {
  const { start: hourStart, end: hourEnd } = hourBounds(appointments, tasks);
  const hours = Array.from({ length: hourEnd - hourStart }, (_, i) => hourStart + i);
  const gridHeight = hours.length * HOUR_HEIGHT;

  return (
    // Zone défilante horizontalement : sans tabIndex, son contenu est
    // inatteignable pour qui navigue au clavier (le défilement ne peut être
    // déclenché qu'à la souris). tabIndex={0} ne change rien à l'affichage,
    // il ajoute seulement une cible de focus.
    <div className="flex overflow-x-auto" tabIndex={0} role="region" aria-label="Grille horaire du calendrier">
      <div className="w-14 shrink-0">
        <div className="h-10" />
        {hours.map((h) => (
          <div key={h} style={{ height: HOUR_HEIGHT }} className="border-t border-border pr-2 text-right text-[11px] text-muted">
            {String(h).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1">
        {days.map((day) => {
          const dayAppts = appointments.filter((a) => isSameDay(toDate(a.startAt), day));
          const dayTasks = tasks.filter((t) => t.dueAt && isSameDay(toDate(t.dueAt), day));
          return (
            <div key={day.toISOString()} className="min-w-[140px] flex-1 border-l border-border first:border-l-0">
              <div className={cn("flex h-10 flex-col items-center justify-center border-b border-border text-xs", isToday(day) && "bg-brand/5")}>
                <span className={cn("font-medium", isToday(day) ? "text-brand" : "text-text")}>
                  {format(day, "EEE d MMM", { locale: fr })}
                </span>
              </div>
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 cursor-pointer border-t border-border hover:bg-bg-subtle"
                    style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    onClick={() => onSelectSlot(set(day, { hours: h, minutes: 0, seconds: 0, milliseconds: 0 }))}
                  />
                ))}
                {dayAppts.map((a) => {
                  const s = toDate(a.startAt);
                  const e = toDate(a.endAt);
                  const top = ((s.getHours() - hourStart) * 60 + s.getMinutes()) * (HOUR_HEIGHT / 60);
                  const height = Math.max(((e.getTime() - s.getTime()) / 60000) * (HOUR_HEIGHT / 60), 20);
                  return <AppointmentBlock key={a.id} appt={a} top={top} height={height} onSelect={onSelectAppointment} />;
                })}
                {dayTasks.map((t) => {
                  const d = toDate(t.dueAt!);
                  const top = ((d.getHours() - hourStart) * 60 + d.getMinutes()) * (HOUR_HEIGHT / 60);
                  return <TaskBlock key={t.id} task={t} top={top} onSelect={onSelectTask} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type MonthItem =
  | { kind: "appointment"; time: Date; data: AgendaAppointment }
  | { kind: "task"; time: Date; data: AgendaTask };

function MonthGrid({
  anchorDate,
  appointments,
  tasks,
  onSelectAppointment,
  onSelectTask,
  onSelectDay,
}: {
  anchorDate: Date;
  appointments: AgendaAppointment[];
  tasks: AgendaTask[];
  onSelectAppointment: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectDay: (date: Date) => void;
}) {
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    // Même principe que TimeGrid (vue jour/semaine) : sous un certain seuil,
    // 7 colonnes pleines deviennent illisibles plutôt que de les tasser à
    // l'infini, on garde une largeur minimale par jour et on défile
    // horizontalement.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase tracking-wide text-muted">
          {weekdayLabels.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dayItems: MonthItem[] = [
              ...appointments
                .filter((a) => isSameDay(toDate(a.startAt), day))
                .map((a): MonthItem => ({ kind: "appointment", time: toDate(a.startAt), data: a })),
              ...tasks
                .filter((t) => t.dueAt && isSameDay(toDate(t.dueAt), day))
                .map((t): MonthItem => ({ kind: "task", time: toDate(t.dueAt!), data: t })),
            ].sort((a, b) => a.time.getTime() - b.time.getTime());
            const visible = dayItems.slice(0, 3);
            const overflow = dayItems.length - visible.length;
            return (
              <div
                key={day.toISOString()}
                onClick={() => onSelectDay(day)}
                className={cn(
                  "min-h-[110px] cursor-pointer border-b border-r border-border p-1.5",
                  !isSameMonth(day, anchorDate) && "bg-bg-subtle/60"
                )}
              >
                <div className={cn("mb-1 text-xs font-medium", isToday(day) ? "text-brand" : !isSameMonth(day, anchorDate) ? "text-muted" : "text-text")}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {visible.map((item) =>
                    item.kind === "appointment" ? (
                      <button
                        key={item.data.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAppointment(item.data.id);
                        }}
                        className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:opacity-90"
                        style={{ backgroundColor: `${item.data.owner.color || "#3b6bf5"}1f`, color: "inherit" }}
                      >
                        <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", statusDotClass(item.data.status))} />
                        {format(item.time, "HH:mm")} {item.data.title}
                      </button>
                    ) : (
                      <button
                        key={item.data.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTask(item.data.id);
                        }}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:opacity-90",
                          item.data.status === "DONE" && "opacity-50 line-through"
                        )}
                        style={{ backgroundColor: `${item.data.assignee.color || "#a855f7"}1f`, color: "inherit" }}
                      >
                        <CheckSquare className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">
                          {format(item.time, "HH:mm")} {item.data.title}
                        </span>
                      </button>
                    )
                  )}
                  {overflow > 0 && <div className="px-1 text-[11px] text-muted">+{overflow} autre(s)</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarView({
  view,
  anchorDate,
  appointments,
  tasks,
  onSelectAppointment,
  onSelectTask,
  onSelectSlot,
  onSelectDay,
}: {
  view: AgendaView;
  anchorDate: Date;
  appointments: AgendaAppointment[];
  tasks: AgendaTask[];
  onSelectAppointment: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectSlot: (date: Date) => void;
  onSelectDay: (date: Date) => void;
}) {
  if (view === "month") {
    return (
      <MonthGrid
        anchorDate={anchorDate}
        appointments={appointments}
        tasks={tasks}
        onSelectAppointment={onSelectAppointment}
        onSelectTask={onSelectTask}
        onSelectDay={onSelectDay}
      />
    );
  }
  const days =
    view === "day"
      ? [anchorDate]
      : eachDayOfInterval({ start: startOfWeek(anchorDate, { weekStartsOn: 1 }), end: endOfWeek(anchorDate, { weekStartsOn: 1 }) });
  return (
    <TimeGrid
      days={days}
      appointments={appointments}
      tasks={tasks}
      onSelectAppointment={onSelectAppointment}
      onSelectTask={onSelectTask}
      onSelectSlot={onSelectSlot}
    />
  );
}

export function getRangeForView(view: AgendaView, anchorDate: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = set(anchorDate, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
    const end = set(anchorDate, { hours: 23, minutes: 59, seconds: 59, milliseconds: 999 });
    return { start, end };
  }
  if (view === "week") {
    return {
      start: startOfWeek(anchorDate, { weekStartsOn: 1 }),
      end: endOfWeek(anchorDate, { weekStartsOn: 1 }),
    };
  }
  return {
    start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }),
  };
}
