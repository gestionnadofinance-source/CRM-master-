import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { Card, Badge } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_BADGE_VARIANT, QUOTE_STATUS_OPTIONS } from "@/server/quotes/status";
import type { Prisma, QuoteStatus } from "@prisma/client";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

export default async function QuotesPage({
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

  // Convention partagée avec les autres modules (agenda, tâches) : un lien
  // "Nouveau devis" depuis la fiche client passe par ?newForClient=<id> sur
  // cette page liste, qu'on relaie vers l'éditeur de création.
  const newForClient = one(sp, "newForClient");
  if (newForClient) {
    redirect(`/c/${crmSlug}/quotes/new?newForClient=${encodeURIComponent(newForClient)}`);
  }
  const newForProspect = one(sp, "newForProspect");
  if (newForProspect) {
    redirect(`/c/${crmSlug}/quotes/new?newForProspect=${encodeURIComponent(newForProspect)}`);
  }

  const status = one(sp, "status");
  const clientId = one(sp, "client");
  const ownerId = one(sp, "owner");
  const from = one(sp, "from");
  const to = one(sp, "to");
  const page = Number(one(sp, "page") || "1") || 1;
  const pageSize = 50;

  const where: Prisma.QuoteWhereInput = { crmId: tenant.crmId };
  if (status) where.status = status as QuoteStatus;
  if (clientId) where.clientId = clientId;
  if (ownerId) where.createdById = ownerId;
  if (from || to) {
    where.issueDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
    };
  }

  const [quotes, total, clients, members, totals] = await Promise.all([
    prisma.quote.findMany({
      where,
      select: {
        id: true,
        number: true,
        object: true,
        status: true,
        issueDate: true,
        validUntil: true,
        totalTtc: true,
        client: { select: { id: true, company: true } },
        prospect: { select: { id: true, company: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { issueDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.quote.count({ where }),
    prisma.client.findMany({ where: { crmId: tenant.crmId }, orderBy: { company: "asc" }, select: { id: true, company: true } }),
    listCrmMembers(tenant.crmId),
    prisma.quote.aggregate({ where, _sum: { totalTtc: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const usp = new URLSearchParams();
    if (status) usp.set("status", status);
    if (clientId) usp.set("client", clientId);
    if (ownerId) usp.set("owner", ownerId);
    if (from) usp.set("from", from);
    if (to) usp.set("to", to);
    usp.set("page", String(p));
    return `/c/${crmSlug}/quotes?${usp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Devis</h1>
          <p className="text-sm text-muted">
            {tenant.crmName} · {total} devis · {formatCurrency(totals._sum.totalTtc ?? 0)} TTC au total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tenant.permissions.has(Permission.MANAGE_SETTINGS) && (
            <Link href={`/c/${crmSlug}/settings`}>
              <Button variant="outline" size="sm">
                Modèles de devis
              </Button>
            </Link>
          )}
          {tenant.permissions.has(Permission.CREATE) && (
            <Link href={`/c/${crmSlug}/quotes/new`}>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Nouveau devis
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label htmlFor="status">Statut</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">Tous</option>
              {QUOTE_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {QUOTE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="client">Client</Label>
            <Select id="client" name="client" defaultValue={clientId}>
              <option value="">Tous</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="owner">Commercial</Label>
            <Select id="owner" name="owner" defaultValue={ownerId}>
              <option value="">Tous</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="from">Émis depuis</Label>
            <Input id="from" name="from" type="date" defaultValue={from} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="to">jusqu&apos;au</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-1">
            <Button type="submit" variant="secondary" size="sm">
              Filtrer
            </Button>
            <Link href={`/c/${crmSlug}/quotes`}>
              <Button type="button" variant="ghost" size="sm">
                Réinitialiser
              </Button>
            </Link>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Numéro</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Objet</th>
                <th className="px-4 py-2.5 font-medium">Commercial</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Émis le</th>
                <th className="px-4 py-2.5 font-medium">Valide jusqu&apos;au</th>
                <th className="px-4 py-2.5 text-right font-medium">Total TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-2.5">
                    <Link href={`/c/${crmSlug}/quotes/${q.id}`} className="font-medium text-text hover:text-brand">
                      {q.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {q.client?.company ?? q.prospect?.company ?? "—"}
                    {q.prospect && !q.client && <Badge variant="brand">Prospect</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{q.object}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {q.createdBy.firstName} {q.createdBy.lastName}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={QUOTE_STATUS_BADGE_VARIANT[q.status]}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(q.issueDate)}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(q.validUntil)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-text">{formatCurrency(q.totalTtc)}</td>
                </tr>
              ))}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    Aucun devis ne correspond à ces critères.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)}>
              <Button type="button" variant="outline" size="sm">
                Précédent
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Précédent
            </Button>
          )}
          <span className="text-muted">
            Page {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)}>
              <Button type="button" variant="outline" size="sm">
                Suivant
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Suivant
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
