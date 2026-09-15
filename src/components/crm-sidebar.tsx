"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CRM_NAV_ITEMS } from "@/lib/nav";
import type { Permission, AccessCategory } from "@prisma/client";

export function CrmSidebar({
  crmSlug,
  permissions,
  category,
  isGlobalAdmin,
  isForeman,
  onNavigate,
}: {
  crmSlug: string;
  permissions: Permission[];
  category: AccessCategory;
  isGlobalAdmin: boolean;
  isForeman: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = new Set(permissions);
  const isOuvrier = category === "OUVRIER" && !isGlobalAdmin;
  const isSecretaire = category === "SECRETAIRE" && !isGlobalAdmin;

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {CRM_NAV_ITEMS.filter((item) => {
        if (item.secretaireOnly) return isSecretaire || isGlobalAdmin;
        // Une SECRETAIRE n'a jamais aucune Permission commerciale (voir
        // effectivePermissions) : pour un onglet à la fois `permission` et
        // `secretaireVisible` (ex. Comptabilité → MANAGE_SETTINGS), le
        // contrôle de permission ne s'applique donc qu'aux catégories qui
        // PEUVENT avoir cette permission — jamais à SECRETAIRE, dont l'accès
        // passe uniquement par secretaireVisible.
        const secretairePermissionBypass = isSecretaire && item.secretaireVisible;
        if (item.permission && !allowed.has(item.permission) && !secretairePermissionBypass) return false;
        if (isOuvrier && item.commercialOnly) return false;
        if (isSecretaire && item.commercialOnly && !item.secretaireVisible) return false;
        if (item.foremanOnly && !isForeman && !isGlobalAdmin) return false;
        return true;
      }).map((item) => {
        const href = item.href(crmSlug);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand/10 text-brand" : "text-muted hover:bg-bg-subtle hover:text-text"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
