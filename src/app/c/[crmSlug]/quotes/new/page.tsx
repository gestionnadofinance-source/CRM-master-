import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { getQuoteEditorData } from "@/server/quotes/actions";
import { QuoteEditor } from "../quote-editor";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crmSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_QUOTES);

  const data = await getQuoteEditorData(tenant.crmId, null);
  if (!data.ok) {
    return <div className="p-6 text-sm text-red-500">{data.error}</div>;
  }

  const newForClientRaw = sp.newForClient;
  const newForClient = typeof newForClientRaw === "string" ? newForClientRaw : "";
  const prefillClientId = data.clients.some((c) => c.id === newForClient) ? newForClient : "";

  const newForProspectRaw = sp.newForProspect;
  const newForProspect = typeof newForProspectRaw === "string" ? newForProspectRaw : "";
  const prefillProspectId = data.prospects.some((p) => p.id === newForProspect) ? newForProspect : "";

  return (
    <QuoteEditor
      crmId={tenant.crmId}
      crmSlug={crmSlug}
      clients={data.clients}
      prospects={data.prospects}
      vatRates={data.vatRates.map((v) => ({ id: v.id, label: v.label, rate: Number(v.rate) }))}
      quote={null}
      activity={[]}
      prefillClientId={prefillClientId}
      prefillProspectId={prefillProspectId}
      defaultConditions={data.defaultConditions}
      defaultMentions={data.defaultMentions}
      canManage={tenant.permissions.has(Permission.MANAGE_QUOTES)}
      canDelete={tenant.permissions.has(Permission.DELETE)}
    />
  );
}
