import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { Card, Badge } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { NewClientButton } from "./new-client-button";
import type { Prisma, ClientStatus } from "@prisma/client";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crmSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug, Permission.MANAGE_CLIENTS);

  const q = one(sp, "q");
  const ownerId = one(sp, "owner");
  const sector = one(sp, "sector");
  const status = one(sp, "status");
  const sourceId = one(sp, "source");
  const tagId = one(sp, "tag");
  const from = one(sp, "from");
  const to = one(sp, "to");
  const page = Number(one(sp, "page") || "1") || 1;
  const pageSize = 50;

  const where: Prisma.ClientWhereInput = { crmId: tenant.crmId };
  if (q) {
    where.OR = [
      { company: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }
  if (ownerId) where.ownerId = ownerId;
  if (sector) where.sector = sector;
  if (status) where.status = status as ClientStatus;
  if (sourceId) where.sourceId = sourceId;
  if (tagId) where.tags = { some: { tagId } };
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
    };
  }

  const [clients, total, sources, tags, members, sectorRows] = await Promise.all([
    prisma.client.findMany({
      where,
      select: {
        id: true,
        company: true,
        email: true,
        phone: true,
        sector: true,
        status: true,
        createdAt: true,
        owner: { select: { firstName: true, lastName: true, color: true } },
        source: { select: { name: true } },
        tags: { include: { tag: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.client.count({ where }),
    prisma.source.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
    prisma.tag.findMany({ where: { crmId: tenant.crmId, scope: "CLIENT" }, orderBy: { name: "asc" } }),
    listCrmMembers(tenant.crmId),
    prisma.client.findMany({
      where: { crmId: tenant.crmId, sector: { not: null } },
      select: { sector: true },
      distinct: ["sector"],
    }),
  ]);

  const sectors = sectorRows.map((r) => r.sector).filter((s): s is string => !!s).sort();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (ownerId) usp.set("owner", ownerId);
    if (sector) usp.set("sector", sector);
    if (status) usp.set("status", status);
    if (sourceId) usp.set("source", sourceId);
    if (tagId) usp.set("tag", tagId);
    if (from) usp.set("from", from);
    if (to) usp.set("to", to);
    usp.set("page", String(p));
    return `/c/${crmSlug}/clients?${usp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Clients</h1>
          <p className="text-sm text-muted">{tenant.crmName} · {total} client(s)</p>
        </div>
        {tenant.permissions.has(Permission.CREATE) && (
          <NewClientButton
            crmId={tenant.crmId}
            crmSlug={crmSlug}
            sources={sources}
            tags={tags}
            members={members}
            currentUserId={ctx.user.id}
          />
        )}
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="q">Recherche</Label>
            <Input id="q" name="q" defaultValue={q} placeholder="Entreprise, email, téléphone" />
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
            <Label htmlFor="sector">Secteur</Label>
            <Select id="sector" name="sector" defaultValue={sector}>
              <option value="">Tous</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Statut</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">Tous</option>
              <option value="ACTIVE">Actif</option>
              <option value="INACTIVE">Inactif</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="source">Source</Label>
            <Select id="source" name="source" defaultValue={sourceId}>
              <option value="">Toutes</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tag">Tag</Label>
            <Select id="tag" name="tag" defaultValue={tagId}>
              <option value="">Tous</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
            <div className="flex-1">
              <Label htmlFor="from">Ajouté depuis</Label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-7">
            <div className="w-40">
              <Label htmlFor="to">jusqu&apos;au</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Filtrer
            </Button>
            <Link href={`/c/${crmSlug}/clients`}>
              <Button type="button" variant="ghost" size="sm">
                Réinitialiser
              </Button>
            </Link>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Entreprise</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium">Secteur</th>
                <th className="px-4 py-2.5 font-medium">Commercial</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Ajouté le</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-2.5">
                    <Link href={`/c/${crmSlug}/clients/${c.id}`} className="font-medium text-text hover:text-brand">
                      {c.company}
                    </Link>
                    {c.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.tags.map(({ tag }) => (
                          <Badge key={tag.id} variant="default">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.sector ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {c.owner.firstName} {c.owner.lastName}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.source?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={c.status === "ACTIVE" ? "success" : "default"}>
                      {c.status === "ACTIVE" ? "Actif" : "Inactif"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Aucun client ne correspond à ces critères.
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
