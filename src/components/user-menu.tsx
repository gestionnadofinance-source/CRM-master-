"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { logout } from "@/server/auth/actions";
import { initials, cn } from "@/lib/utils";
import type { SessionUser } from "@/server/auth/session";
import { Settings, LogOut, ShieldCheck } from "lucide-react";

export function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: user.color }}
        title={`${user.firstName} ${user.lastName}`}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          initials(user.firstName, user.lastName)
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-surface py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-text">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link
            href="/settings"
            className={cn("flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-bg-subtle")}
            onClick={() => setOpen(false)}
          >
            <Settings className="h-4 w-4" /> Paramètres
          </Link>
          {user.isGlobalAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-bg-subtle"
              onClick={() => setOpen(false)}
            >
              <ShieldCheck className="h-4 w-4" /> Administration
            </Link>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-bg-subtle dark:text-red-400"
            >
              <LogOut className="h-4 w-4" /> Déconnexion
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
