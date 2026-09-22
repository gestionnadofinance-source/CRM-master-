"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import {
  listRecentNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/server/notifications/actions";
import { entityUrl } from "@/lib/entity-links";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { cn, formatDate } from "@/lib/utils";

type NotificationItem = Awaited<ReturnType<typeof listRecentNotifications>>[number];

const POLL_INTERVAL_MS = 20_000;

export function NotificationsBell({ crmId, crmSlug }: { crmId: string; crmSlug: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function refresh() {
    const count = await countUnreadNotifications(crmId);
    setUnread(count);
  }

  async function refreshList() {
    const list = await listRecentNotifications(crmId);
    setItems(list);
  }

  const { connected } = useRealtimeChannel(`private-crm-${crmId}`, {
    "notification.created": () => {
      refresh();
      if (open) refreshList();
    },
  });

  // Le sondage périodique n'est qu'un repli : si le canal temps réel est
  // actif, "notification.created" ci-dessus suffit et le sondage s'arrête.
  useEffect(() => {
    refresh();
    if (connected) return;
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crmId, connected]);

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
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) refreshList();
        }}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-text"
        // Bouton sans texte : l'icône seule ne donne aucun nom accessible. Le
        // compte non lu est annoncé ici parce que la pastille rouge qui le
        // porte visuellement est, elle, purement graphique.
        aria-label={unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        // Sous sm, ancrer via "right-0" (relatif à la cloche) ferait déborder
        // à gauche de l'écran dès que la cloche n'est pas collée au bord
        // droit (ex : après le bouton menu mobile) — on positionne alors
        // le panneau par rapport au viewport plutôt que par rapport au
        // bouton, avec une marge de chaque côté.
        <div className="fixed inset-x-2 top-16 z-50 rounded-md border border-border bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-text">Notifications</p>
            <button
              className="text-xs text-brand hover:underline"
              onClick={() =>
                startTransition(async () => {
                  await markAllNotificationsRead(crmId);
                  setUnread(0);
                  refreshList();
                })
              }
            >
              Tout marquer comme lu
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Aucune notification.</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  startTransition(async () => {
                    await markNotificationRead(crmId, n.id);
                    refresh();
                  });
                  const url = entityUrl(crmSlug, n.entityType, n.entityId);
                  setOpen(false);
                  if (url) router.push(url);
                }}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-bg-subtle",
                  !n.readAt && "bg-brand/5"
                )}
              >
                <span className="text-sm text-text">{n.title}</span>
                {n.body && <span className="text-xs text-muted">{n.body}</span>}
                <span className="text-[11px] text-muted">{formatDate(n.createdAt, true)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
