import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, requireCommercial } from "@/server/tenant";
import { listThreads, listCrmMembers } from "@/server/messages/actions";
import { MessagesView } from "./messages-view";

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { crmSlug } = await params;
  const { thread } = await searchParams;
  const ctx = await requireAuth();
  // requireCrmAccessBySlug lève une AuthError (interceptée par le layout
  // parent, qui répond 404) si l'utilisateur n'a pas accès à ce CRM — donc
  // aucun thread d'un autre CRM ne peut jamais être atteint via cette page.
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  requireCommercial(tenant);

  const [threads, members] = await Promise.all([listThreads(crmSlug), listCrmMembers(crmSlug)]);

  return (
    <MessagesView
      crmSlug={crmSlug}
      currentUserId={ctx.user.id}
      initialThreads={threads}
      members={members}
      initialThreadId={thread ?? null}
    />
  );
}
