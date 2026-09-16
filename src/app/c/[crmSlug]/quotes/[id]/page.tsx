import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlugOrNotFound } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { getQuoteEditorData } from "@/server/quotes/actions";
import { QuoteEditor } from "../quote-editor";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ crmSlug: string; id: string }>;
}) {
  const { crmSlug, id } = await params;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug, Permission.MANAGE_QUOTES);

  const data = await getQuoteEditorData(tenant.crmId, id);
  if (!data.ok || !data.quote) notFound();

  const q = data.quote;

  return (
    <QuoteEditor
      crmId={tenant.crmId}
      crmSlug={crmSlug}
      clients={data.clients}
      prospects={data.prospects}
      vatRates={data.vatRates.map((v) => ({ id: v.id, label: v.label, rate: Number(v.rate) }))}
      quote={{
        id: q.id,
        number: q.number,
        clientId: q.clientId,
        prospectId: q.prospectId,
        object: q.object,
        issueDate: toDateInputValue(q.issueDate),
        validUntil: toDateInputValue(q.validUntil),
        status: q.status,
        conditions: q.conditions,
        mentions: q.mentions,
        totalHt: Number(q.totalHt),
        totalVat: Number(q.totalVat),
        totalTtc: Number(q.totalTtc),
        currentVersion: q.currentVersion,
        createdByName: `${q.createdBy.firstName} ${q.createdBy.lastName}`,
        sentAt: q.sentAt ? q.sentAt.toISOString() : null,
        acceptedAt: q.acceptedAt ? q.acceptedAt.toISOString() : null,
        refusedAt: q.refusedAt ? q.refusedAt.toISOString() : null,
        items: q.items.map((item) => ({
          id: item.id,
          designation: item.designation,
          quantity: Number(item.quantity),
          unitPriceHt: Number(item.unitPriceHt),
          vatRateId: item.vatRateId,
        })),
        versions: q.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
          authorName: `${v.author.firstName} ${v.author.lastName}`,
          snapshot: v.snapshot as unknown,
        })),
      }}
      activity={data.activity.map((a) => ({
        id: a.id,
        action: a.action,
        createdAt: a.createdAt.toISOString(),
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : "Système",
      }))}
      prefillClientId=""
      prefillProspectId=""
      defaultConditions=""
      defaultMentions=""
      canManage={tenant.permissions.has(Permission.MANAGE_QUOTES)}
      canDelete={tenant.permissions.has(Permission.DELETE)}
    />
  );
}
