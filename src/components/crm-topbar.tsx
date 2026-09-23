import { Menu } from "lucide-react";
import { CrmSwitcher, type CrmOption } from "@/components/crm-switcher";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import type { SessionUser } from "@/server/auth/session";

export function CrmTopbar({
  user,
  current,
  options,
  onMenuClick,
}: {
  user: SessionUser;
  current: CrmOption;
  options: CrmOption[];
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 sm:gap-4 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            aria-label="Ouvrir le menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <CrmSwitcher current={current} options={options} />
      </div>
      <div className="flex flex-1" />
      <div className="flex items-center gap-1 sm:gap-2">
        <NotificationsBell crmId={current.id} crmSlug={current.slug} />
        <ThemeToggle current={user.theme} />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
