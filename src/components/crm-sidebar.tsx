"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CRM_NAV_ITEMS, type NavAudience } from "@/lib/nav";
import type { AccessCategory } from "@prisma/client";

export function CrmSidebar({
  crmSlug,
  category,
  isGlobalAdmin,
  isForeman,
  onNavigate,
}: {
  crmSlug: string;
  category: AccessCategory;
  isGlobalAdmin: boolean;
  isForeman: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const audience: NavAudience = isGlobalAdmin ? "ADMIN" : category === "SECRETAIRE" ? "SECRETAIRE" : "OUVRIER";

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {CRM_NAV_ITEMS.filter((item) => {
        if (!item.visibleTo.includes(audience)) return false;
        // Les onglets de pointage ne concernent qu'un chef de chantier ;
        // l'administration et la secrétaire les voient toujours.
        if (item.foremanOnly && audience === "OUVRIER" && !isForeman) return false;
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
