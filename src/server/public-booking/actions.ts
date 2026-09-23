"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/server/activity";
import { notifyCrm } from "@/server/notifications/create";
import { publishToCrm } from "@/lib/realtime";
import {
  getBookableCommercials,
  getSlotsForCommercialOnDate,
  findBestFirstSlot,
  toSlotSettings,
  isBookableCommercial,
} from "@/server/public-booking/availability";
import { startOfDay } from "date-fns";
import { assertNotRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { MAX_CODE, MAX_ID, tooLong } from "@/lib/validation";

const PUBLIC_SOURCE_NAME = "Réservation en ligne";

/** Récupère le CRM + ses réglages de réservation STRICTEMENT à partir du
 * slug public de l'URL. Ne fait jamais confiance à un identifiant de CRM
 * transmis par le client : il n'y a d'ailleurs aucune session ici. */
async function resolvePublicCrm(publicSlug: string) {
  const crm = await prisma.crm.findFirst({
    where: { bookingSettings: { publicSlug } },
    include: { bookingSettings: true },
  });
  if (!crm || !crm.isActive || !crm.bookingSettings || !crm.bookingSettings.isEnabled) return null;
  return crm;
}

function stripControlChars(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
}

// ============================================================================
// Landing
// ============================================================================

export interface PublicBookingLanding {
  ok: boolean;
  crmName?: string;
  introMessage?: string | null;
  slotDurationMinutes?: number;
  minNoticeHours?: number;
  maxAdvanceDays?: number;
}

export async function getPublicBookingLanding(publicSlug: string): Promise<PublicBookingLanding> {
  const crm = await resolvePublicCrm(publicSlug);
  if (!crm || !crm.bookingSettings) return { ok: false };
  return {
    ok: true,
    crmName: crm.name,
    introMessage: crm.bookingSettings.introMessage,
    slotDurationMinutes: crm.bookingSettings.slotDurationMinutes,
    minNoticeHours: crm.bookingSettings.minNoticeHours,
    maxAdvanceDays: crm.bookingSettings.maxAdvanceDays,
  };
}

export async function listPublicCommercials(publicSlug: string) {
  const crm = await resolvePublicCrm(publicSlug);
  if (!crm) return [];
  return getBookableCommercials(crm.id);
}

// ============================================================================
// Créneaux
// ============================================================================

const dateInputSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");

export async function getPublicSlotsForDate(
  publicSlug: string,
  commercialId: string,
  dateISO: string
): Promise<string[]> {
  const crm = await resolvePublicCrm(publicSlug);
  if (!crm || !crm.bookingSettings) return [];
  const parsedDate = dateInputSchema.safeParse(dateISO);
  if (!parsedDate.success) return [];
  if (!(await isBookableCommercial(crm.id, commercialId))) return [];

  const day = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(day.getTime())) return [];

  const slots = await getSlotsForCommercialOnDate(crm.id, commercialId, day, toSlotSettings(crm.bookingSettings));
  return slots.map((s) => s.toISOString());
}

export interface PublicFirstAvailableResult {
  startAt: string;
  endAt: string;
  commercialId: string;
  commercialName: string;
}

export async function getPublicFirstAvailable(
  publicSlug: string,
  afterISO?: string
): Promise<PublicFirstAvailableResult | null> {
  const crm = await resolvePublicCrm(publicSlug);
  if (!crm || !crm.bookingSettings) return null;

  const after = afterISO ? new Date(afterISO) : undefined;
  if (after && Number.isNaN(after.getTime())) return null;

  const best = await findBestFirstSlot(crm.id, crm.bookingSettings, new Date(), after);
  if (!best) return null;

  const endAt = new Date(best.startAt.getTime() + crm.bookingSettings.slotDurationMinutes * 60_000);
  return {
    startAt: best.startAt.toISOString(),
    endAt: endAt.toISOString(),
    commercialId: best.userId,
    commercialName: best.displayName,
  };
}

// ============================================================================
// Soumission de la réservation
// ============================================================================

const bookingSubmitSchema = z.object({
  commercialId: z.string().trim().max(MAX_ID, tooLong(MAX_ID)).min(1, "Veuillez choisir un commercial."),
  startAt: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1, "Créneau invalide."),
  endAt: z.string().max(MAX_CODE, tooLong(MAX_CODE)).min(1, "Créneau invalide."),
  firstName: z.string().trim().min(1, "Le prénom est obligatoire.").max(100),
  lastName: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  email: z.string().trim().email("Adresse email invalide.").max(200),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\-\s]*$/, "Numéro de téléphone invalide.")
    .nullable(),
  company: z.string().trim().max(200).nullable(),
  message: z.string().trim().max(2000).nullable(),
});

export interface PublicBookingSubmitResult {
  ok: boolean;
  error?: string;
  slotTaken?: boolean;
  appointmentId?: string;
}

export async function submitPublicBooking(
  publicSlug: string,
  formData: FormData
): Promise<PublicBookingSubmitResult> {
  const crm = await resolvePublicCrm(publicSlug);
  if (!crm || !crm.bookingSettings) {
    return { ok: false, error: "La réservation en ligne n'est pas disponible pour le moment." };
  }

  // Seul point d'entrée public capable d'écrire des données réelles (un
  // rendez-vous) sans authentification : sans limite, un script pourrait
  // saturer tous les créneaux disponibles d'un commercial. Même principe
  // que la limite de connexion (src/server/auth/rate-limit.ts).
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) {
    try {
      await assertNotRateLimited("public-booking", ip, { windowMinutes: 60, maxAttempts: 5 });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    await recordRateLimitHit("public-booking", ip);
  }

  const emptyToNull = (v: FormDataEntryValue | null) => {
    const s = v == null ? "" : stripControlChars(String(v));
    return s === "" ? null : s;
  };

  const raw = {
    commercialId: String(formData.get("commercialId") ?? "").trim(),
    startAt: String(formData.get("startAt") ?? "").trim(),
    endAt: String(formData.get("endAt") ?? "").trim(),
    firstName: stripControlChars(String(formData.get("firstName") ?? "")),
    lastName: stripControlChars(String(formData.get("lastName") ?? "")),
    email: stripControlChars(String(formData.get("email") ?? "")).toLowerCase(),
    phone: emptyToNull(formData.get("phone")),
    company: emptyToNull(formData.get("company")),
    message: emptyToNull(formData.get("message")),
  };
  const parsed = bookingSubmitSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const data = parsed.data;

  const start = new Date(data.startAt);
  const end = new Date(data.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, error: "Créneau invalide." };
  }
  if (start < new Date()) {
    return { ok: false, error: "Ce créneau est déjà passé." };
  }

  if (!(await isBookableCommercial(crm.id, data.commercialId))) {
    return { ok: false, error: "Ce commercial n'est plus disponible pour la réservation en ligne." };
  }

  const settings = toSlotSettings(crm.bookingSettings);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Revalidation stricte de la disponibilité au moment de la
        // soumission, pour éviter une double réservation en cas de course
        // entre deux visiteurs sur le même créneau.
        const [rules, exceptions, conflicting] = await Promise.all([
          tx.availabilityRule.findMany({
            where: { crmId: crm.id, userId: data.commercialId },
            select: { weekday: true, startTime: true, endTime: true },
          }),
          tx.availabilityException.findMany({
            where: {
              crmId: crm.id,
              userId: data.commercialId,
              startAt: { lt: end },
              endAt: { gt: start },
            },
          }),
          tx.appointment.findFirst({
            where: {
              crmId: crm.id,
              ownerId: data.commercialId,
              status: { not: "CANCELLED" },
              startAt: { lt: end },
              endAt: { gt: start },
            },
          }),
        ]);

        if (conflicting) {
          return { ok: false as const, slotTaken: true, error: "Ce créneau vient d'être réservé par une autre personne." };
        }
        if (exceptions.length > 0) {
          return { ok: false as const, slotTaken: true, error: "Ce créneau n'est plus disponible." };
        }
        const jsDay = start.getDay();
        const weekday = (jsDay + 6) % 7;
        const matchesRule = rules.some((r) => {
          if (r.weekday !== weekday) return false;
          const [sh, sm] = r.startTime.split(":").map(Number);
          const [eh, em] = r.endTime.split(":").map(Number);
          const ruleStart = new Date(start);
          ruleStart.setHours(sh ?? 0, sm ?? 0, 0, 0);
          const ruleEnd = new Date(start);
          ruleEnd.setHours(eh ?? 0, em ?? 0, 0, 0);
          return start >= ruleStart && end <= ruleEnd;
        });
        if (!matchesRule) {
          return { ok: false as const, slotTaken: true, error: "Ce créneau n'est plus disponible." };
        }
        const minNoticeOk = start.getTime() - Date.now() >= settings.minNoticeHours * 60 * 60 * 1000;
        if (!minNoticeOk) {
          return { ok: false as const, slotTaken: true, error: "Ce créneau est trop proche pour être réservé." };
        }
        const maxAdvanceOk = startOfDay(start).getTime() <= startOfDay(new Date()).getTime() + settings.maxAdvanceDays * 86_400_000;
        if (!maxAdvanceOk) {
          return { ok: false as const, slotTaken: true, error: "Ce créneau est trop éloigné pour être réservé." };
        }

        // Source "Réservation en ligne" (créée si nécessaire pour ce CRM).
        const source = await tx.source.upsert({
          where: { crmId_name: { crmId: crm.id, name: PUBLIC_SOURCE_NAME } },
          update: {},
          create: { crmId: crm.id, name: PUBLIC_SOURCE_NAME, order: 999 },
        });

        // Recherche d'un prospect existant (email insensible à la casse,
        // sinon téléphone) strictement dans ce CRM ; sinon création.
        let prospect = await tx.prospect.findFirst({
          where: { crmId: crm.id, email: { equals: data.email, mode: "insensitive" } },
        });
        if (!prospect && data.phone) {
          prospect = await tx.prospect.findFirst({ where: { crmId: crm.id, phone: data.phone } });
        }
        if (!prospect) {
          prospect = await tx.prospect.create({
            data: {
              crmId: crm.id,
              company: data.company || `${data.firstName} ${data.lastName}`,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone,
              sourceId: source.id,
              ownerId: data.commercialId,
              status: "TO_FOLLOW_UP",
              nextContactAt: start,
            },
          });
        } else {
          await tx.prospect.update({
            where: { id: prospect.id },
            data: { nextContactAt: start },
          });
        }

        const appointment = await tx.appointment.create({
          data: {
            crmId: crm.id,
            title: `RDV en ligne — ${data.firstName} ${data.lastName}`,
            prospectId: prospect.id,
            ownerId: data.commercialId,
            startAt: start,
            endAt: end,
            status: "SCHEDULED",
            isPublicBooking: true,
            bookingContactName: `${data.firstName} ${data.lastName}`,
            bookingContactEmail: data.email,
            bookingContactPhone: data.phone,
            bookingMessage: data.message,
          },
        });

        return { ok: true as const, appointmentId: appointment.id, prospectId: prospect.id, crmId: crm.id };
      },
      { isolationLevel: "Serializable" }
    );

    if (!result.ok) {
      return { ok: false, error: result.error, slotTaken: result.slotTaken };
    }

    await logActivity({
      crmId: crm.id,
      action: "appointment.public_booking",
      entityType: "APPOINTMENT",
      entityId: result.appointmentId,
      appointmentId: result.appointmentId,
      prospectId: result.prospectId,
      newValue: { startAt: start.toISOString(), commercialId: data.commercialId },
    });
    await notifyCrm({
      crmId: crm.id,
      type: "APPOINTMENT_CREATED",
      title: "Nouvelle réservation en ligne",
      body: `${data.firstName} ${data.lastName} a réservé un créneau.`,
      entityType: "APPOINTMENT",
      entityId: result.appointmentId,
    });
    await publishToCrm(crm.id, "appointment.upserted", { id: result.appointmentId });

    return { ok: true, appointmentId: result.appointmentId };
  } catch (err) {
    // Conflit de sérialisation Postgres (P2034) : deux réservations
    // concurrentes sur le même créneau, l'une des deux doit échouer proprement.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2034") {
      return { ok: false, error: "Ce créneau vient d'être réservé par une autre personne. Merci d'en choisir un autre.", slotTaken: true };
    }
    return { ok: false, error: "Une erreur est survenue lors de la réservation. Merci de réessayer." };
  }
}
