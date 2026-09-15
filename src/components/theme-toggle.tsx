"use client";

import { useTransition } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { setThemePreference } from "@/server/preferences/actions";
import { cn } from "@/lib/utils";

const options = [
  { value: "LIGHT" as const, icon: Sun, label: "Clair" },
  { value: "DARK" as const, icon: Moon, label: "Sombre" },
  { value: "SYSTEM" as const, icon: MonitorSmartphone, label: "Système" },
];

export function ThemeToggle({ current }: { current: "LIGHT" | "DARK" | "SYSTEM" }) {
  const [isPending, startTransition] = useTransition();

  function apply(theme: "LIGHT" | "DARK" | "SYSTEM") {
    const isDark = theme === "DARK" || (theme === "SYSTEM" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    startTransition(() => {
      setThemePreference(theme);
    });
  }

  return (
    <div className="inline-flex items-center rounded-md border border-border bg-bg-subtle p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={isPending}
          onClick={() => apply(opt.value)}
          title={opt.label}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded",
            current === opt.value ? "bg-surface shadow-sm text-brand" : "text-muted hover:text-text"
          )}
        >
          <opt.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
