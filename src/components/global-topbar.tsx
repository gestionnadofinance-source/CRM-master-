import Link from "next/link";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import type { SessionUser } from "@/server/auth/session";

export function GlobalTopbar({
  user,
  title,
  onMenuClick,
}: {
  user: SessionUser;
  title?: string;
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            aria-label="Ouvrir le menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <Link href="/home" className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-brand-fg">
            CM
          </div>
          <span className="truncate text-sm font-semibold text-text">{title ?? "CRM Master"}</span>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle current={user.theme} />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
