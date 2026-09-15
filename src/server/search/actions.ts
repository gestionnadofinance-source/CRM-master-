"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccess } from "@/server/tenant";
import { Permission } from "@/server/permissions";

export interface SearchResult {
  type: "client" | "prospect" | "quote" | "task" | "appointment";
  id: string;
  title: string;
  subtitle: string;
}

/**
 * Recherche globale strictement scoped au CRM courant : chaque requête
 * filtre explicitement par crmId après vérification d'accès, jamais de
 * recherche transverse aux autres CRM.
 */
export async function globalSearch(crmId: string, query: string): Promise<SearchResult[]> {
  const ctx = await requireAuth();
  // Un ouvrier/chef de chantier n'a par conception aucune permission
  // commerciale (voir effectivePermissions) : sans ce Permission.VIEW,
  // requireCrmAccess() sans permission ne bloque que les non-membres du
  // CRM, pas les ouvriers qui y ont accès pour Planning/Coffre-fort.
  const tenant = await requireCrmAccess(ctx, crmId, Permission.VIEW);
  const q = query.trim();
  if (q.length < 2) return [];

  const [clients, prospects, quotes, tasks] = await Promise.all([
    prisma.client.findMany({
      where: {
        crmId: tenant.crmId,
        OR: [
          { company: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { siret: { contains: q } },
        ],
      },
      take: 5,
    }),
    prisma.prospect.findMany({
      where: {
        crmId: tenant.crmId,
        OR: [
          { company: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { siret: { contains: q } },
        ],
      },
      take: 5,
    }),
    prisma.quote.findMany({
      where: { crmId: tenant.crmId, number: { contains: q, mode: "insensitive" } },
      include: { client: true, prospect: true },
      take: 5,
    }),
    prisma.task.findMany({
      where: { crmId: tenant.crmId, title: { contains: q, mode: "insensitive" } },
      take: 5,
    }),
  ]);

  return [
    ...clients.map((c): SearchResult => ({ type: "client", id: c.id, title: c.company, subtitle: c.email ?? "Client" })),
    ...prospects.map((p): SearchResult => ({ type: "prospect", id: p.id, title: p.company, subtitle: p.email ?? "Prospect" })),
    ...quotes.map((q2): SearchResult => ({ type: "quote", id: q2.id, title: q2.number, subtitle: (q2.client ?? q2.prospect)?.company ?? "Devis" })),
    ...tasks.map((t): SearchResult => ({ type: "task", id: t.id, title: t.title, subtitle: "Tâche" })),
  ];
}
