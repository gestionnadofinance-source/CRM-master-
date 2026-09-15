import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { listAvailabilityRules, listAvailabilityExceptions, listPublicBookingAppointments } from "@/server/availability/actions";
import { AvailabilityClient } from "./availability-client";

export default async function BookingSettingsPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_APPOINTMENTS);

  const [members, rules, exceptions, publicAppointments, bookingSettings] = await Promise.all([
    listCrmMembers(tenant.crmId),
    listAvailabilityRules(tenant.crmId, ctx.user.id),
    listAvailabilityExceptions(tenant.crmId, ctx.user.id),
    listPublicBookingAppointments(tenant.crmId),
    prisma.bookingSettings.findUnique({ where: { crmId: tenant.crmId }, select: { publicSlug: true, isEnabled: true } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Prise de rendez-vous</h1>
        <p className="text-sm text-muted">{tenant.crmName} · configurez vos disponibilités pour la réservation en ligne</p>
      </div>
      <AvailabilityClient
        crmId={tenant.crmId}
        currentUserId={ctx.user.id}
        members={members}
        initialRules={rules}
        initialExceptions={exceptions}
        publicAppointments={publicAppointments}
        publicSlug={bookingSettings?.publicSlug ?? null}
        publicBookingEnabled={bookingSettings?.isEnabled ?? false}
      />
    </div>
  );
}
