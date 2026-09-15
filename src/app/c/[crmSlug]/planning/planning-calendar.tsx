"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addYears,
  addQuarters,
  addWeeks,
  startOfYear,
  endOfYear,
  startOfQuarter,
  endOfQuarter,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  eachDayOfInterval,
  format,
  isSameDay,
  max as dateMax,
  min as dateMin,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, initials } from "@/lib/utils";

export type CalendarView = "year" | "quarter" | "week";

export interface PlanningCalendarChantier {
  id: string;
  name: string;
  color: string;
  status: string;
  startDate: Date | string;
  endDate: Date | string;
  assignments: { id: string; user: { id: string; firstName: string; lastName: string; color: string } }[];
}

/**
 * Vue calendrier du planning (Année / Trimestre / Semaine) — remplace la
 * grille de cartes : chaque chantier est une barre positionnée sur sa
 * période, les chantiers qui se chevauchent sont empilés sur des lignes
 * distinctes plutôt que superposés. Un clic sur une barre ouvre le même
 * détail (affectations, édition, suppression) qu'auparavant sur la carte —
 * voir onSelect, câblé par planning-client.tsx qui garde toute la logique
 * métier inchangée (cette vue est purement de la présentation).
 */

function getRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "year") return { start: startOfYear(anchor), end: endOfYear(anchor) };
  if (view === "quarter") return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
}

function shiftAnchor(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
  if (view === "year") return addYears(anchor, dir);
  if (view === "quarter") return addQuarters(anchor, dir);
  return addWeeks(anchor, dir);
}

function rangeLabel(view: CalendarView, range: { start: Date; end: Date }): string {
  if (view === "year") return format(range.start, "yyyy");
  if (view === "quarter") return `T${Math.floor(range.start.getMonth() / 3) + 1} ${format(range.start, "yyyy")}`;
  return `Semaine du ${format(range.start, "dd/MM/yyyy")} au ${format(range.end, "dd/MM/yyyy")}`;
}

/** Empile les chantiers qui se chevauchent sur des lignes distinctes (algorithme glouton classique). */
function assignLanes(items: { id: string; start: number; end: number }[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    laneOf.set(item.id, lane);
  }
  return laneOf;
}

const LANE_HEIGHT = 40;
const LANE_GAP = 6;

export function PlanningCalendar({
  chantiers,
  currentUserId,
  onSelect,
}: {
  chantiers: PlanningCalendarChantier[];
  currentUserId: string;
  onSelect: (id: string) => void;
}) {
  const [view, setView] = useState<CalendarView>("quarter");
  const [anchor, setAnchor] = useState(new Date());
  // "now" ne doit être calculé qu'après le montage client : le rendu serveur
  // et l'hydratation ne tournent jamais exactement à la même milliseconde,
  // ce qui décale légèrement la position du repère "aujourd'hui" et déclenche
  // une erreur d'hydratation React. On rend donc ce repère absent au premier
  // rendu (identique serveur/client) puis on le fait apparaître après coup.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const now = mounted ? new Date() : null;

  const range = useMemo(() => getRange(view, anchor), [view, anchor]);
  const rangeStartMs = range.start.getTime();
  const rangeMs = range.end.getTime() - rangeStartMs;
  const pct = (d: Date) => ((d.getTime() - rangeStartMs) / rangeMs) * 100;

  const visible = useMemo(
    () =>
      chantiers.filter((c) => {
        const s = new Date(c.startDate).getTime();
        const e = new Date(c.endDate).getTime();
        return e >= range.start.getTime() && s <= range.end.getTime();
      }),
    [chantiers, range]
  );

  const laneOf = useMemo(
    () =>
      assignLanes(
        visible.map((c) => ({
          id: c.id,
          start: Math.max(new Date(c.startDate).getTime(), range.start.getTime()),
          end: Math.min(new Date(c.endDate).getTime(), range.end.getTime()),
        }))
      ),
    [visible, range]
  );
  const laneCount = visible.length === 0 ? 1 : Math.max(...visible.map((c) => (laneOf.get(c.id) ?? 0) + 1));

  const headerCells = useMemo(() => {
    if (view === "week") {
      return eachDayOfInterval({ start: range.start, end: range.end }).map((d) => ({
        key: d.toISOString(),
        label: format(d, "EEE dd/MM", { locale: fr }),
        left: pct(d),
        width: 100 / 7,
        isToday: !!now && isSameDay(d, now),
      }));
    }
    return eachMonthOfInterval({ start: range.start, end: range.end }).map((m) => {
      const s = dateMax([startOfMonth(m), range.start]);
      const e = dateMin([endOfMonth(m), range.end]);
      const left = pct(s);
      return {
        key: m.toISOString(),
        label: format(m, view === "year" ? "MMM" : "MMMM", { locale: fr }),
        left,
        width: pct(e) - left,
        isToday: !!now && now >= s && now <= e,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, range, now]);

  const todayPct = now && now >= range.start && now <= range.end ? pct(now) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-text">{rangeLabel(view, range)}</span>
          <Button variant="outline" size="sm" onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>
            Aujourd&apos;hui
          </Button>
        </div>
        <div className="flex rounded-md border border-border">
          {(["year", "quarter", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md",
                view === v ? "bg-brand text-brand-fg" : "bg-surface text-text hover:bg-bg-subtle"
              )}
            >
              {v === "year" ? "Année" : v === "quarter" ? "Trimestre" : "Semaine"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <div className="min-w-[640px]">
          <div className="relative flex border-b border-border bg-bg-subtle text-xs text-muted">
            {headerCells.map((cell) => (
              <div
                key={cell.key}
                style={{ width: `${cell.width}%` }}
                className={cn(
                  "shrink-0 truncate border-r border-border px-2 py-1.5 text-center capitalize last:border-r-0",
                  cell.isToday && "bg-brand/10 font-medium text-brand"
                )}
              >
                {cell.label}
              </div>
            ))}
          </div>

          <div
            className="relative"
            style={{ height: `${laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_GAP}px` }}
          >
            {todayPct !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand/60"
                style={{ left: `${todayPct}%` }}
              />
            )}
            {visible.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
                Aucun chantier sur cette période.
              </p>
            )}
            {visible.map((c) => {
              const s = dateMax([new Date(c.startDate), range.start]);
              const e = dateMin([new Date(c.endDate), range.end]);
              const left = pct(s);
              const width = Math.max(pct(e) - left, 1.5);
              const lane = laneOf.get(c.id) ?? 0;
              const isMine = c.assignments.some((a) => a.user.id === currentUserId);
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  title={c.name}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    top: `${lane * (LANE_HEIGHT + LANE_GAP) + LANE_GAP}px`,
                    height: `${LANE_HEIGHT}px`,
                    backgroundColor: c.color,
                  }}
                  className={cn(
                    "absolute flex items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs font-medium text-white shadow-sm transition-transform hover:scale-[1.01] hover:shadow-md",
                    c.status === "COMPLETED" && "opacity-60",
                    isMine && "ring-2 ring-white ring-offset-1 ring-offset-brand"
                  )}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto flex shrink-0 -space-x-1.5">
                    {c.assignments.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-white/70 text-[9px] font-semibold text-white"
                        style={{ backgroundColor: a.user.color }}
                      >
                        {initials(a.user.firstName, a.user.lastName)}
                      </span>
                    ))}
                    {c.assignments.length > 3 && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/70 bg-black/30 text-[9px] font-semibold text-white">
                        +{c.assignments.length - 3}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
