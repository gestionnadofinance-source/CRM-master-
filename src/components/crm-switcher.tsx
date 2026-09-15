"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CrmOption {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export function CrmSwitcher({ current, options }: { current: CrmOption; options: CrmOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
        className="flex h-9 max-w-[9.5rem] items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 text-sm font-medium text-text hover:border-brand/40 sm:max-w-none"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-64 rounded-md border border-border bg-surface py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setOpen(false);
                router.push(`/c/${opt.slug}/dashboard`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text hover:bg-bg-subtle"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opt.color }} />
              <span className="flex-1 text-left">{opt.name}</span>
              {opt.id === current.id && <Check className="h-4 w-4 text-brand" />}
            </button>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/home");
              }}
              className={cn("flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-bg-subtle")}
            >
              <LayoutGrid className="h-4 w-4" />
              Tous les CRM
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
