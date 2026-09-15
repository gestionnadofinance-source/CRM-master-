import { getPublicBookingLanding } from "@/server/public-booking/actions";
import { BookingFlow } from "./booking-flow";
import { CalendarX } from "lucide-react";

export default async function PublicBookingPage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  const landing = await getPublicBookingLanding(publicSlug);

  if (!landing.ok) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface p-10 text-center">
        <CalendarX className="h-10 w-10 text-muted" />
        <h1 className="text-lg font-semibold text-text">Réservation indisponible</h1>
        <p className="max-w-sm text-sm text-muted">
          Ce lien de réservation n&apos;est plus actif. Merci de contacter directement l&apos;entreprise pour prendre rendez-vous.
        </p>
      </div>
    );
  }

  return (
    <BookingFlow
      publicSlug={publicSlug}
      crmName={landing.crmName!}
      introMessage={landing.introMessage ?? null}
      slotDurationMinutes={landing.slotDurationMinutes!}
      minNoticeHours={landing.minNoticeHours!}
      maxAdvanceDays={landing.maxAdvanceDays!}
    />
  );
}
