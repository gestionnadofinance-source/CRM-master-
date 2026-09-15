"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Users } from "lucide-react";
import { listThreads, listCrmMembers } from "@/server/messages/actions";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { ConversationPanel } from "./conversation-panel";
import { NewConversationModal } from "./new-conversation-modal";

type ThreadItem = Awaited<ReturnType<typeof listThreads>>[number];
type Member = Awaited<ReturnType<typeof listCrmMembers>>[number];

const THREAD_POLL_MS = 18_000;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function MessagesView({
  crmSlug,
  currentUserId,
  initialThreads,
  members,
  initialThreadId,
}: {
  crmSlug: string;
  currentUserId: string;
  initialThreads: ThreadItem[];
  members: Member[];
  initialThreadId: string | null;
}) {
  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  // Ne présélectionner que sur un lien explicite (?thread=...) — auto-ouvrir
  // la première conversation par défaut lâchait un visiteur mobile
  // directement dans une conversation au lieu de la liste.
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  const refreshThreads = useCallback(async () => {
    const list = await listThreads(crmSlug);
    setThreads(list);
  }, [crmSlug]);

  useEffect(() => {
    const interval = setInterval(refreshThreads, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshThreads]);

  useRealtimeChannel(`private-user-${currentUserId}`, {
    "message.created": () => refreshThreads(),
    "notification.created": () => refreshThreads(),
  });

  function selectThread(id: string) {
    setSelectedId(id);
    router.replace(`/c/${crmSlug}/messages?thread=${id}`, { scroll: false });
  }

  function clearSelection() {
    setSelectedId(null);
    router.replace(`/c/${crmSlug}/messages`, { scroll: false });
  }

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* Sur mobile il n'y a la place que pour un seul volet à la fois : la
          liste des conversations et le fil de discussion se remplacent l'un
          l'autre selon qu'une conversation est sélectionnée, avec une
          flèche retour côté conversation. À partir de md, les deux
          s'affichent côte à côte comme avant. */}
      <aside
        className={cn(
          "flex w-full flex-shrink-0 flex-col border-r border-border bg-surface md:w-80",
          selected && "hidden md:flex"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-text">Messagerie</h1>
          <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
            <MessageSquarePlus className="h-4 w-4" />
            Nouvelle
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 && (
            <p className="p-4 text-sm text-muted">Aucune conversation pour le moment. Démarrez-en une !</p>
          )}
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => selectThread(t.id)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left hover:bg-bg-subtle",
                selectedId === t.id && "bg-brand/5"
              )}
            >
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.type === "GROUP" ? <Users className="h-4 w-4" /> : initialsFromName(t.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", t.unread ? "font-semibold text-text" : "text-text")}>
                    {t.name}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-muted">{formatDate(t.lastActivityAt, true)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted">
                    {t.lastMessage ? `${t.lastMessage.mine ? "Vous : " : ""}${t.lastMessage.body || "Pièce jointe"}` : "Aucun message"}
                  </span>
                  {t.unread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" />}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className={cn("flex min-w-0 flex-1 flex-col", !selected && "hidden md:flex")}>
        {selected ? (
          <ConversationPanel
            key={selected.id}
            crmSlug={crmSlug}
            currentUserId={currentUserId}
            threadId={selected.id}
            title={selected.name}
            type={selected.type}
            onMessageSent={refreshThreads}
            onBack={clearSelection}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            Sélectionnez une conversation pour commencer, ou démarrez-en une nouvelle.
          </div>
        )}
      </section>

      <NewConversationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        crmSlug={crmSlug}
        members={members}
        onCreated={(threadId) => {
          setModalOpen(false);
          refreshThreads();
          selectThread(threadId);
        }}
      />
    </div>
  );
}
