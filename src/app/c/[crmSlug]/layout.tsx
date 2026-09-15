import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireActiveAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, listAccessibleCrms } from "@/server/tenant";
import { AuthError } from "@/server/auth/session";
import { amIForeman } from "@/server/pointage/actions";
import { CrmShell } from "./crm-shell";

// Onglets accessibles à la catégorie OUVRIER : tout le reste (dashboard,
// pipeline, clients, prospects, agenda, devis, tâches, messagerie,
// activité, paramètres...) est réservé à la catégorie COMMERCIAL. Ce
// contrôle est le pendant serveur du filtrage visuel de la sidebar
// (src/lib/nav.ts, src/components/crm-sidebar.tsx) : la navigation seule
// ne protège rien, un accès direct par URL doit être bloqué ici aussi. Les
// pages Pointage salariés/client vérifient en plus, elles-mêmes, que
// l'utilisateur est bien chef de chantier (voir requireForeman côté
// serveur) : ce préfixe ne fait que les rendre atteignables pour un
// Ouvrier, pas accessibles en écriture.
const OUVRIER_ALLOWED_PREFIXES = ["/planning", "/vault", "/pointage-salaries", "/pointage-client"];

// Catégorie SECRETAIRE ("accès total admin" hors données commerciales — voir
// prisma/schema.prisma AccessCategory) : mêmes onglets que OUVRIER, plus
// Tableau de bord, Utilisateurs (gestion des accès de CE CRM, voir
// /c/[crmSlug]/users) et Activité. Jamais Pipeline/Agenda/Clients/
// Prospects/Devis/Tâches/Messagerie/Paramètres CRM.
const SECRETAIRE_ALLOWED_PREFIXES = [
  "/dashboard",
  "/planning",
  "/vault",
  "/pointage-salaries",
  "/pointage-client",
  "/activity",
  "/users",
  "/comptabilite",
];

export default async function CrmLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ crmSlug: string }>;
}) {
  const { crmSlug } = await params;
  const ctx = await requireActiveAuth();

  let tenant;
  try {
    tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  if (!tenant.isGlobalAdmin && (tenant.category === "OUVRIER" || tenant.category === "SECRETAIRE")) {
    const allowedPrefixes = tenant.category === "OUVRIER" ? OUVRIER_ALLOWED_PREFIXES : SECRETAIRE_ALLOWED_PREFIXES;
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    const relativePath = pathname.replace(`/c/${crmSlug}`, "") || "/";
    const isAllowed = allowedPrefixes.some((p) => relativePath === p || relativePath.startsWith(`${p}/`));
    if (!isAllowed) {
      redirect(`/c/${crmSlug}/${tenant.category === "OUVRIER" ? "planning" : "dashboard"}`);
    }
  }

  const [accessible, isForeman] = await Promise.all([listAccessibleCrms(ctx), amIForeman(tenant.crmId)]);
  const current = { id: tenant.crmId, slug: tenant.crmSlug, name: tenant.crmName, color: "#3b6bf5" };
  const options = accessible.map((c) => ({ id: c.id, slug: c.slug, name: c.name, color: c.color }));
  const currentFull = options.find((o) => o.id === current.id) ?? current;

  return (
    <CrmShell
      user={ctx.user}
      current={currentFull}
      options={options}
      crmSlug={crmSlug}
      permissions={Array.from(tenant.permissions)}
      category={tenant.category}
      isGlobalAdmin={tenant.isGlobalAdmin}
      isForeman={isForeman}
    >
      {children}
    </CrmShell>
  );
}
