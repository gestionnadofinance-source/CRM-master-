import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, Badge } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import { requireAuth } from "@/server/auth/session";
import { queryActivityLog } from "@/server/admin/queries";

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

function summarizeDiff(oldValue: unknown, newValue: unknown): string {
  if (!oldValue && !newValue) return "—";
  try {
    if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object") {
      const before = oldValue as Record<string, unknown>;
      const after = newValue as Record<string, unknown>;
      const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length === 0) return "Aucun changement de champ";
      return changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`).join(" · ");
    }
    if (newValue) return JSON.stringify(newValue).slice(0, 160);
    return JSON.stringify(oldValue).slice(0, 160);
  } catch {
    return "—";
  }
}

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Voir le commentaire équivalent dans admin/page.tsx : le layout admin
  // ne suffit pas seul à empêcher un non-admin d'atteindre cette page.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const sp = await searchParams;
  const crmId = one(sp, "crm");
  const userId = one(sp, "user");
  const entityType = one(sp, "entityType");
  const from = one(sp, "from");
  const to = one(sp, "to");
  const page = Number(one(sp, "page") || "1") || 1;

  const [result, crms, users, entityTypes] = await Promise.all([
    queryActivityLog({
      crmId: crmId || undefined,
      userId: userId || undefined,
      entityType: entityType || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(`${to}T23:59:59`) : undefined,
      page,
      pageSize: 30,
    }),
    prisma.crm.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.activityLog.findMany({ distinct: ["entityType"], select: { entityType: true }, take: 50 }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (crmId) params.set("crm", crmId);
    if (userId) params.set("user", userId);
    if (entityType) params.set("entityType", entityType);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(p));
    return `/admin/activity?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Journal d&apos;activité global</h1>
        <p className="text-sm text-muted">{result.total} entrée(s) — toutes CRM confondues, réservé aux administrateurs.</p>
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label htmlFor="crm">CRM</Label>
            <Select id="crm" name="crm" defaultValue={crmId}>
              <option value="">Tous</option>
              {crms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="user">Utilisateur</Label>
            <Select id="user" name="user" defaultValue={userId}>
              <option value="">Tous</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="entityType">Type</Label>
            <Select id="entityType" name="entityType" defaultValue={entityType}>
              <option value="">Tous</option>
              {entityTypes.map((e) => (
                <option key={e.entityType} value={e.entityType}>
                  {e.entityType}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="from">Du</Label>
            <Input id="from" name="from" type="date" defaultValue={from} />
          </div>
          <div>
            <Label htmlFor="to">Au</Label>
            <Input id="to" name="to" type="date" defaultValue={to} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Filtrer
            </Button>
            <Link href="/admin/activity">
              <Button type="button" variant="ghost" size="sm">
                Réinitialiser
              </Button>
            </Link>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">CRM</th>
                <th className="px-4 py-2.5 font-medium">Utilisateur</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Entité</th>
                <th className="px-4 py-2.5 font-medium">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDate(r.createdAt, true)}</td>
                  <td className="px-4 py-2.5">
                    {r.crmName ? <Badge variant="default">{r.crmName}</Badge> : <span className="text-muted">Global</span>}
                  </td>
                  <td className="px-4 py-2.5 text-text">{r.userName ?? "Système"}</td>
                  <td className="px-4 py-2.5 text-text">{translateActivityAction(r.action)}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {r.entityType}
                    {r.entityId ? ` #${r.entityId.slice(-6)}` : ""}
                  </td>
                  <td className="max-w-md truncate px-4 py-2.5 text-xs text-muted" title={summarizeDiff(r.oldValue, r.newValue)}>
                    {summarizeDiff(r.oldValue, r.newValue)}
                  </td>
                </tr>
              ))}
              {result.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    Aucune entrée ne correspond à ces critères.
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
            <Link href={qs(page - 1)}>
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
            <Link href={qs(page + 1)}>
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
