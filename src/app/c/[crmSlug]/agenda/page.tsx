import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { listCrmMembers } from "@/server/shared/members";
import { AgendaClient } from "./agenda-client";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crmSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_APPOINTMENTS);

  const members = await listCrmMembers(tenant.crmId);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Agenda</h1>
        <p className="text-sm text-muted">{tenant.crmName}</p>
      </div>
      <AgendaClient
        crmId={tenant.crmId}
        crmSlug={crmSlug}
        currentUserId={ctx.user.id}
        members={members}
        canDelete={tenant.permissions.has(Permission.DELETE)}
        initialAppointmentId={one(sp, "appointment")}
        initialNewForClientId={one(sp, "newForClient")}
        initialNewForProspectId={one(sp, "newForProspect")}
      />
    </div>
  );
}
