"use client";

import { useTransition } from "react";
import { revokeOwnSession } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { Session } from "@prisma/client";

export function SessionsList({ sessions, currentSessionId }: { sessions: Session[]; currentSessionId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <ul className="divide-y divide-border">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
          <div>
            <p className="text-text">
              {s.userAgent?.slice(0, 60) ?? "Appareil inconnu"} {s.id === currentSessionId && <span className="text-brand">(cette session)</span>}
            </p>
            <p className="text-xs text-muted">
              {s.ipAddress ?? "IP inconnue"} · dernière activité {formatDate(s.lastSeenAt, true)}
            </p>
          </div>
          {s.id !== currentSessionId && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => startTransition(() => revokeOwnSession(s.id))}
            >
              Révoquer
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
