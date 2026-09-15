"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, File as FileIcon, Paperclip, Send, Users, X } from "lucide-react";
import { getThreadMessages, sendMessage } from "@/server/messages/actions";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";

type ThreadData = Awaited<ReturnType<typeof getThreadMessages>>;
type Message = ThreadData["messages"][number];

const POLL_INTERVAL_MS = 5_000;

export function ConversationPanel({
  crmSlug,
  currentUserId,
  threadId,
  title,
  type,
  onMessageSent,
  onBack,
}: {
  crmSlug: string;
  currentUserId: string;
  threadId: string;
  title: string;
  type: string;
  onMessageSent?: () => void;
  /** Affiche une flèche retour (mobile uniquement) pour revenir à la liste des conversations. */
  onBack?: () => void;
}) {
  // Les messages sont chargés par pages (voir getThreadMessages) : `thread`
  // porte les métadonnées (nom, participants, s'il existe un historique plus
  // ancien), `messages` est construite localement au fil du temps plutôt que
  // remplacée à chaque rafraîchissement — un fil ouvert longtemps ne relit
  // ainsi jamais tout son historique. `pullLatest` ne redemande que ce qui
  // est postérieur au dernier message déjà connu (curseur `after`) et
  // l'ajoute à la suite ; `loadOlder` préfixe une page plus ancienne
  // (curseur `before`) sur demande explicite.
  const [thread, setThread] = useState<Omit<ThreadData, "messages"> | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [denied, setDenied] = useState(false);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  async function pullLatest() {
    const last = messagesRef.current[messagesRef.current.length - 1];
    try {
      const res = await getThreadMessages(crmSlug, threadId, last ? { after: last.id } : undefined);
      const { messages: fetched, ...rest } = res;
      setThread(rest);
      setMessages((prev) => {
        if (!last) return fetched;
        if (fetched.length === 0) return prev;
        const known = new Set(prev.map((m) => m.id));
        const toAdd = fetched.filter((m) => !known.has(m.id));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
      setDenied(false);
    } catch {
      setDenied(true);
    }
  }

  async function loadOlder() {
    const first = messagesRef.current[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    try {
      const res = await getThreadMessages(crmSlug, threadId, { before: first.id });
      setMessages((prev) => [...res.messages, ...prev]);
      setThread((t) => (t ? { ...t, hasMoreBefore: res.hasMoreBefore } : t));
      // Préserve la position de lecture : sans ça, préfixer des messages
      // plus anciens ferait visuellement "sauter" le contenu déjà affiché,
      // la hauteur totale du conteneur venant de grandir au-dessus du point
      // de défilement actuel.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;
      });
    } catch {
      // Un échec ponctuel de chargement d'historique n'empêche pas de continuer à utiliser la conversation.
    } finally {
      setLoadingOlder(false);
    }
  }

  const { connected } = useRealtimeChannel(`private-user-${currentUserId}`, {
    "message.created": (payload: unknown) => {
      const p = payload as { threadId?: string } | undefined;
      if (p?.threadId === threadId) pullLatest();
    },
  });

  // Le sondage périodique n'est qu'un repli : si le canal temps réel est
  // actif, "message.created" ci-dessus suffit et le sondage s'arrête.
  useEffect(() => {
    setMessages([]);
    messagesRef.current = [];
    setThread(null);
    setDenied(false);
    pullLatest();
    if (connected) return;
    const interval = setInterval(pullLatest, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, crmSlug, connected]);

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    // Uniquement au changement de fil ou à l'arrivée d'un nouveau message —
    // pas quand loadOlder préfixe de l'historique, qui gère son propre
    // maintien de position ci-dessus.
  }, [threadId, lastMessageId]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim() && !file) return;
    setError(null);
    const fd = new FormData();
    fd.set("body", body);
    if (file) fd.set("file", file);
    startTransition(async () => {
      const res = await sendMessage(crmSlug, threadId, fd);
      if (!res.ok) {
        setError(res.error ?? "Erreur lors de l'envoi.");
        return;
      }
      setBody("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await pullLatest();
      onMessageSent?.();
    });
  }

  if (denied) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Conversation introuvable ou accès non autorisé.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {onBack && (
          <button onClick={onBack} aria-label="Retour aux conversations" className="text-muted hover:text-text md:hidden">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {type === "GROUP" && <Users className="h-4 w-4 text-muted" />}
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {thread && type === "GROUP" && (
          <span className="text-xs text-muted">
            · {thread.participants.length} membre{thread.participants.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!thread && <p className="text-sm text-muted">Chargement…</p>}
        {thread?.hasMoreBefore && (
          <div className="flex justify-center pb-1">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-text disabled:opacity-60"
            >
              {loadingOlder ? "Chargement…" : "Charger les messages précédents"}
            </button>
          </div>
        )}
        {thread && messages.length === 0 && <p className="text-sm text-muted">Aucun message. Dites bonjour !</p>}
        {messages.map((m) => {
          const mine = m.author.id === currentUserId;
          return (
            <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: m.author.color }}
              >
                {m.author.firstName.charAt(0)}
                {m.author.lastName.charAt(0)}
              </span>
              <div className={cn("max-w-[70%] space-y-1", mine && "flex flex-col items-end")}>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-text">{mine ? "Vous" : `${m.author.firstName} ${m.author.lastName}`}</span>
                  <span className="text-[11px] text-muted">{formatDate(m.createdAt, true)}</span>
                </div>
                {m.body && (
                  <div
                    className={cn(
                      "inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                      mine ? "bg-brand text-brand-fg" : "bg-bg-subtle text-text"
                    )}
                  >
                    {m.body}
                  </div>
                )}
                {m.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/documents/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-brand hover:underline"
                  >
                    <FileIcon className="h-3.5 w-3.5" />
                    {a.fileName}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-bg-subtle px-2 py-1 text-xs text-muted">
            <Paperclip className="h-3.5 w-3.5" />
            {file.name}
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="ml-auto hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} title="Joindre un fichier">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Écrivez un message…"
            className="min-h-9 flex-1 resize-none py-2"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
          <Button type="submit" size="icon" disabled={pending || (!body.trim() && !file)} title="Envoyer">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
