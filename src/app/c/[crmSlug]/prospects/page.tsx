import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlugOrNotFound } from "@/server/tenant";
import { Permission } from "@/server/permissions";
import { prisma } from "@/lib/prisma";
import { listCrmMembers } from "@/server/shared/members";
import { Card, Badge } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { NewProspectButton } from "./new-prospect-button";
import type { Prisma } from "@prisma/client";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "hot", label: "Chauds" },
  { key: "cold", label: "Froids" },
  { key: "follow_up", label: "À relancer" },
  { key: "inactive", label: "Sans activité" },
  { key: "converted", label: "Convertis" },
  { key: "lost", label: "Perdus" },
];

const NO_ACTIVITY_DAYS = 30;

const STATUS_BADGE: Record<string, "default" | "success" | "warning" | "danger" | "brand"> = {
  HOT: "danger",
  COLD: "brand",
  TO_FOLLOW_UP: "warning",
  CONVERTED: "success",
  LOST: "default",
};

const STATUS_LABELS: Record<string, string> = {
  HOT: "Chaud",
  COLD: "Froid",
  TO_FOLLOW_UP: "À relancer",
  CONVERTED: "Converti",
  LOST: "Perdu",
};

export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ crmSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crmSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlugOrNotFound(ctx, crmSlug, Permission.MANAGE_PROSPECTS);

  const view = one(sp, "view") || "all";
  const q = one(sp, "q");
  const ownerId = one(sp, "owner");
  const sector = one(sp, "sector");
  const sourceId = one(sp, "source");
  const tagId = one(sp, "tag");
  const page = Number(one(sp, "page") || "1") || 1;
  const pageSize = 50;

  const where: Prisma.ProspectWhereInput = { crmId: tenant.crmId };
  if (q) {
    where.OR = [
      { company: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }
  if (ownerId) where.ownerId = ownerId;
  if (sector) where.sector = sector;
  if (sourceId) where.sourceId = sourceId;
  if (tagId) where.tags = { some: { tagId } };

  const cutoff = new Date(Date.now() - NO_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
  switch (view) {
    case "hot":
      where.status = "HOT";
      break;
    case "cold":
      where.status = "COLD";
      break;
    case "follow_up":
      where.status = "TO_FOLLOW_UP";
      break;
    case "converted":
      where.status = "CONVERTED";
      break;
    case "lost":
      where.status = "LOST";
      break;
    case "inactive": {
      where.status = { notIn: ["CONVERTED", "LOST"] };
      const inactivityFilter: Prisma.ProspectWhereInput = {
        OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }],
      };
      // Combined as AND with the text-search OR (if any) rather than merged into the same OR array.
      where.AND = [inactivityFilter];
      break;
    }
  }

  const [prospects, total, sources, tags, members, sectorRows] = await Promise.all([
    prisma.prospect.findMany({
      where,
      select: {
        id: true,
        company: true,
        email: true,
        phone: true,
        sector: true,
        status: true,
        score: true,
        lastContactAt: true,
        createdAt: true,
        owner: { select: { firstName: true, lastName: true } },
        source: { select: { name: true } },
        tags: { include: { tag: true } },
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.prospect.count({ where }),
    prisma.source.findMany({ where: { crmId: tenant.crmId }, orderBy: { order: "asc" } }),
    prisma.tag.findMany({ where: { crmId: tenant.crmId, scope: "PROSPECT" }, orderBy: { name: "asc" } }),
    // Un prospect n'est jamais suivi par un ouvrier/chef de chantier : seuls
    // les commerciaux (et les admins globaux) peuvent être choisis comme
    // commercial alloué.
    listCrmMembers(tenant.crmId).then((all) => all.filter((m) => m.isGlobalAdmin || m.category === "COMMERCIAL")),
    prisma.prospect.findMany({
      where: { crmId: tenant.crmId, sector: { not: null } },
      select: { sector: true },
      distinct: ["sector"],
    }),
  ]);

  const sectors = sectorRows.map((r) => r.sector).filter((s): s is string => !!s).sort();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ownerId) params.set("owner", ownerId);
    if (sector) params.set("sector", sector);
    if (sourceId) params.set("source", sourceId);
    if (tagId) params.set("tag", tagId);
    if (tabKey !== "all") params.set("view", tabKey);
    const qs = params.toString();
    return `/c/${crmSlug}/prospects${qs ? `?${qs}` : ""}`;
  }

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (ownerId) params.set("owner", ownerId);
    if (sector) params.set("sector", sector);
    if (sourceId) params.set("source", sourceId);
    if (tagId) params.set("tag", tagId);
    if (view !== "all") params.set("view", view);
    params.set("page", String(p));
    return `/c/${crmSlug}/prospects?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Prospects</h1>
          <p className="text-sm text-muted">
            {tenant.crmName} · {total} prospect(s)
          </p>
        </div>
        {tenant.permissions.has(Permission.CREATE) && (
          <NewProspectButton
            crmId={tenant.crmId}
            crmSlug={crmSlug}
            sources={sources}
            tags={tags}
            members={members}
            currentUserId={ctx.user.id}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              view === t.key ? "bg-brand text-brand-fg" : "text-muted hover:bg-bg-subtle hover:text-text"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
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
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Filtrer
            </Button>
            <Link href={`/c/${crmSlug}/prospects`}>
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
                <th className="px-4 py-2.5 font-medium">Score</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Dernier contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {prospects.map((p) => (
                <tr key={p.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-2.5">
                    <Link href={`/c/${crmSlug}/prospects/${p.id}`} className="font-medium text-text hover:text-brand">
                      {p.company}
                    </Link>
                    {p.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.tags.map(({ tag }) => (
                          <Badge key={tag.id} variant="default">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {p.email && <div>{p.email}</div>}
                    {p.phone && <div>{p.phone}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{p.sector ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {p.owner.firstName} {p.owner.lastName}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={p.score >= 60 ? "danger" : p.score >= 30 ? "warning" : "default"}>{p.score}/100</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={STATUS_BADGE[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{p.lastContactAt ? formatDate(p.lastContactAt) : "—"}</td>
                </tr>
              ))}
              {prospects.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Aucun prospect ne correspond à ces critères.
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
