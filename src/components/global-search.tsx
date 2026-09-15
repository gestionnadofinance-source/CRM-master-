"use client";

import { useEffect, useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { globalSearch, type SearchResult } from "@/server/search/actions";

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  client: "Client",
  prospect: "Prospect",
  quote: "Devis",
  task: "Tâche",
  appointment: "Rendez-vous",
};

function resultHref(crmSlug: string, r: SearchResult): string {
  switch (r.type) {
    case "client":
      return `/c/${crmSlug}/clients/${r.id}`;
    case "prospect":
      return `/c/${crmSlug}/prospects/${r.id}`;
    case "quote":
      return `/c/${crmSlug}/quotes/${r.id}`;
    case "task":
      return `/c/${crmSlug}/tasks?task=${r.id}`;
    case "appointment":
      return `/c/${crmSlug}/agenda?appointment=${r.id}`;
  }
}

export function GlobalSearch({ crmId, crmSlug }: { crmId: string; crmSlug: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

  const runSearch = useCallback(
    (q: string) => {
      setQuery(q);
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      startTransition(async () => {
        const res = await globalSearch(crmId, q);
        setResults(res);
      });
    },
    [crmId]
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Rechercher"
        className="flex h-9 w-9 items-center justify-center gap-2 rounded-md border border-border bg-bg-subtle px-3 text-sm text-muted hover:border-brand/40 md:w-72 md:justify-start"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Rechercher...</span>
        <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] md:inline">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16 sm:pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Rechercher clients, prospects, devis, tâches..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button onClick={() => setOpen(false)}>
            <X className="h-4 w-4 text-muted" />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {isPending && <p className="px-3 py-4 text-sm text-muted">Recherche...</p>}
          {!isPending && query.length >= 2 && results.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted">Aucun résultat.</p>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => {
                setOpen(false);
                router.push(resultHref(crmSlug, r));
              }}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-bg-subtle"
            >
              <span className="text-text">{r.title}</span>
              <span className="text-xs text-muted">
                {TYPE_LABEL[r.type]} · {r.subtitle}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
