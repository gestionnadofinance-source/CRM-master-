import "server-only";
import { prisma } from "@/lib/prisma";
import {
  addDays,
  addHours,
  addMinutes,
  isAfter,
  isBefore,
  startOfDay,
  endOfDay,
  subDays,
} from "date-fns";
import type { AvailabilityException, BookingSettings } from "@prisma/client";

export interface BookableCommercial {
  id: string;
  displayName: string;
}

/**
 * Un commercial est "réservable" publiquement s'il a un accès actif à ce
 * CRM (ou est administrateur global) ET a défini au moins un créneau de
 * disponibilité récurrent pour ce CRM. Seul le prénom (+ initiale du nom)
 * est exposé publiquement : jamais l'email, le téléphone ni le profil complet.
 */
export async function getBookableCommercials(crmId: string): Promise<BookableCommercial[]> {
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ isGlobalAdmin: true }, { crmAccess: { some: { crmId } } }],
      availabilityRules: { some: { crmId } },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    displayName: `${u.firstName} ${u.lastName.charAt(0)}.`,
  }));
}

export async function isBookableCommercial(crmId: string, userId: string): Promise<boolean> {
  const commercials = await getBookableCommercials(crmId);
  return commercials.some((c) => c.id === userId);
}

interface SlotSettings {
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function combineDateAndTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** Calcule les créneaux disponibles pour un utilisateur donné, un seul jour. */
export function computeSlotsForDay(params: {
  day: Date;
  now: Date;
  settings: SlotSettings;
  rules: { weekday: number; startTime: string; endTime: string }[];
  exceptions: Pick<AvailabilityException, "startAt" | "endAt" | "allDay">[];
  busy: { startAt: Date; endAt: Date }[];
}): Date[] {
  const { day, now, settings, rules, exceptions, busy } = params;
  // 0 = lundi ... 6 = dimanche (JS getDay() renvoie 0 = dimanche)
  const jsDay = day.getDay();
  const weekday = (jsDay + 6) % 7;

  const rulesForDay = rules.filter((r) => r.weekday === weekday);
  if (rulesForDay.length === 0) return [];

  const minStart = addHours(now, settings.minNoticeHours);
  const maxDate = addDays(startOfDay(now), settings.maxAdvanceDays);
  if (isAfter(startOfDay(day), maxDate)) return [];

  const slots: Date[] = [];
  for (const rule of rulesForDay) {
    const rangeEnd = combineDateAndTime(day, rule.endTime);
    let cursor = combineDateAndTime(day, rule.startTime);
    while (addMinutes(cursor, settings.slotDurationMinutes) <= rangeEnd) {
      const slotStart = cursor;
      const slotEnd = addMinutes(cursor, settings.slotDurationMinutes);
      cursor = addMinutes(cursor, settings.slotDurationMinutes + settings.bufferMinutes);

      if (isBefore(slotStart, minStart)) continue;
      if (isAfter(slotStart, maxDate)) continue;

      const blockedByException = exceptions.some((ex) => {
        const exStart = ex.allDay ? startOfDay(ex.startAt) : ex.startAt;
        const exEnd = ex.allDay ? endOfDay(ex.endAt) : ex.endAt;
        return overlaps(slotStart, slotEnd, exStart, exEnd);
      });
      if (blockedByException) continue;

      const blockedByAppointment = busy.some((a) => overlaps(slotStart, slotEnd, a.startAt, a.endAt));
      if (blockedByAppointment) continue;

      slots.push(slotStart);
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

async function loadUserAvailabilityData(crmId: string, userId: string, rangeStart: Date, rangeEnd: Date) {
  const [rules, exceptions, appointments] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { crmId, userId }, select: { weekday: true, startTime: true, endTime: true } }),
    prisma.availabilityException.findMany({
      where: { crmId, userId, startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
      select: { startAt: true, endAt: true, allDay: true },
    }),
    prisma.appointment.findMany({
      where: { crmId, ownerId: userId, status: { not: "CANCELLED" }, startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
      select: { startAt: true, endAt: true },
    }),
  ]);
  return { rules, exceptions, appointments };
}

/** Renvoie les créneaux disponibles pour un commercial sur une seule journée. */
export async function getSlotsForCommercialOnDate(
  crmId: string,
  userId: string,
  day: Date,
  settings: SlotSettings,
  now: Date = new Date()
): Promise<Date[]> {
  const rangeStart = startOfDay(day);
  const rangeEnd = endOfDay(day);
  const { rules, exceptions, appointments } = await loadUserAvailabilityData(crmId, userId, rangeStart, rangeEnd);
  return computeSlotsForDay({
    day: rangeStart,
    now,
    settings,
    rules,
    exceptions,
    busy: appointments,
  });
}

const MAX_SCAN_DAYS_SAFETY = 180;

/**
 * Cherche le tout premier créneau disponible pour un commercial, en
 * parcourant les jours à partir d'aujourd'hui (ou après `after` si fourni),
 * jusqu'à `maxAdvanceDays`.
 */
export async function findEarliestSlotForCommercial(
  crmId: string,
  userId: string,
  settings: SlotSettings,
  now: Date = new Date(),
  after?: Date
): Promise<Date | null> {
  const rangeStart = startOfDay(now);
  const rangeEnd = addDays(startOfDay(now), settings.maxAdvanceDays + 1);
  const { rules, exceptions, appointments } = await loadUserAvailabilityData(crmId, userId, rangeStart, rangeEnd);

  const scanDays = Math.min(settings.maxAdvanceDays + 1, MAX_SCAN_DAYS_SAFETY);
  for (let i = 0; i <= scanDays; i++) {
    const day = addDays(rangeStart, i);
    const daySlots = computeSlotsForDay({ day, now, settings, rules, exceptions, busy: appointments });
    const filtered = after ? daySlots.filter((s) => isAfter(s, after)) : daySlots;
    if (filtered.length > 0) return filtered[0] ?? null;
  }
  return null;
}

export interface BestSlotCandidate {
  userId: string;
  displayName: string;
  startAt: Date;
}

/**
 * Mode "premier créneau disponible" : calcule le plus tôt créneau libre
 * pour chaque commercial réservable, puis choisit le gagnant. Si
 * balancedDistribution est actif, parmi les commerciaux dont le plus tôt
 * créneau tombe le même jour, on préfère celui qui a le moins de rendez-vous
 * sur les 30 derniers jours (répartition équitable de la charge).
 */
export async function findBestFirstSlot(
  crmId: string,
  settings: BookingSettings,
  now: Date = new Date(),
  after?: Date
): Promise<BestSlotCandidate | null> {
  const commercials = await getBookableCommercials(crmId);
  if (commercials.length === 0) return null;

  const candidates: BestSlotCandidate[] = [];
  for (const c of commercials) {
    const slot = await findEarliestSlotForCommercial(crmId, c.id, settings, now, after);
    if (slot) candidates.push({ userId: c.id, displayName: c.displayName, startAt: slot });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const firstCandidate = candidates[0]!;
  const minDayKey = startOfDay(firstCandidate.startAt).getTime();
  const sameDay = candidates.filter((c) => startOfDay(c.startAt).getTime() === minDayKey);

  if (!settings.balancedDistribution || sameDay.length === 1) {
    return sameDay[0] ?? firstCandidate;
  }

  const since = subDays(now, 30);
  const counts = await Promise.all(
    sameDay.map((c) =>
      prisma.appointment.count({
        where: { crmId, ownerId: c.userId, status: { not: "CANCELLED" }, createdAt: { gte: since } },
      })
    )
  );
  let bestIndex = 0;
  for (let i = 1; i < sameDay.length; i++) {
    const countI = counts[i]!;
    const countBest = counts[bestIndex]!;
    if (
      countI < countBest ||
      (countI === countBest && sameDay[i]!.startAt.getTime() < sameDay[bestIndex]!.startAt.getTime())
    ) {
      bestIndex = i;
    }
  }
  return sameDay[bestIndex] ?? firstCandidate;
}

export function toSlotSettings(bs: BookingSettings): SlotSettings {
  return {
    slotDurationMinutes: bs.slotDurationMinutes,
    bufferMinutes: bs.bufferMinutes,
    minNoticeHours: bs.minNoticeHours,
    maxAdvanceDays: bs.maxAdvanceDays,
  };
}
