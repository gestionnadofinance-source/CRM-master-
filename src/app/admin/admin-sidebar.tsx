"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Building2, History, CalendarRange, Lock, KeyRound, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { label: "Tableau de bord", href: "/admin", icon: LayoutDashboard },
  { label: "Utilisateurs", href: "/admin/users", icon: Users },
  { label: "CRM", href: "/admin/crms", icon: Building2 },
  { label: "Planning", href: "/admin/planning", icon: CalendarRange },
  { label: "Coffres-forts", href: "/admin/vault", icon: Lock },
  { label: "Comptabilité", href: "/admin/comptabilite", icon: Calculator },
  { label: "Clés API", href: "/admin/api-keys", icon: KeyRound },
  { label: "Journal d'activité", href: "/admin/activity", icon: History },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="p-3">
      <ul className="space-y-1">
        {ADMIN_NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-brand/10 text-brand" : "text-text hover:bg-bg-subtle"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
