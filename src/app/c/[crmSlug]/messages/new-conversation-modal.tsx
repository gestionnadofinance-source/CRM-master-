"use client";

import { useState, useTransition } from "react";
import { User, Users } from "lucide-react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { startDirectThread, startGroupThread, listCrmMembers } from "@/server/messages/actions";
import { cn } from "@/lib/utils";

type Member = Awaited<ReturnType<typeof listCrmMembers>>[number];

export function NewConversationModal({
  open,
  onClose,
  crmSlug,
  members,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  crmSlug: string;
  members: Member[];
  onCreated: (threadId: string) => void;
}) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("direct");
    setSelected([]);
    setGroupName("");
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function toggle(id: string) {
    if (mode === "direct") {
      setSelected([id]);
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
  }

  function submit() {
    setError(null);
    if (mode === "direct") {
      const targetId = selected[0];
      if (!targetId) {
        setError("Choisissez un destinataire.");
        return;
      }
      startTransition(async () => {
        const res = await startDirectThread(crmSlug, targetId);
        if (!res.ok || !res.threadId) {
          setError(res.error ?? "Une erreur est survenue.");
          return;
        }
        onCreated(res.threadId);
        reset();
      });
    } else {
      if (!groupName.trim()) {
        setError("Donnez un nom au groupe.");
        return;
      }
      if (selected.length === 0) {
        setError("Sélectionnez au moins un participant.");
        return;
      }
      startTransition(async () => {
        const res = await startGroupThread(crmSlug, { name: groupName.trim(), participantIds: selected });
        if (!res.ok || !res.threadId) {
          setError(res.error ?? "Une erreur est survenue.");
          return;
        }
        onCreated(res.threadId);
        reset();
      });
    }
  }

  return (
    <Modal open={open} onClose={close} title="Nouvelle conversation" width="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "direct" ? "primary" : "outline"}
            onClick={() => {
              setMode("direct");
              setSelected([]);
            }}
          >
            <User className="h-4 w-4" />
            Message direct
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "group" ? "primary" : "outline"}
            onClick={() => {
              setMode("group");
              setSelected([]);
            }}
          >
            <Users className="h-4 w-4" />
            Groupe
          </Button>
        </div>

        {mode === "group" && (
          <div>
            <Label htmlFor="groupName">Nom du groupe</Label>
            <Input
              id="groupName"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Ex : Équipe commerciale, Direction, Techniciens…"
            />
          </div>
        )}

        <div>
          <Label>{mode === "direct" ? "Destinataire" : "Participants"}</Label>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {members.length === 0 && (
              <p className="p-2 text-sm text-muted">Aucun autre utilisateur n&apos;a accès à ce CRM.</p>
            )}
            {members.map((m) => {
              const isSelected = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-subtle",
                    isSelected && "bg-brand/10"
                  )}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.firstName.charAt(0)}
                    {m.lastName.charAt(0)}
                  </span>
                  <span className="flex-1 text-text">
                    {m.firstName} {m.lastName}
                  </span>
                  {isSelected && <span className="text-xs text-brand">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Création…" : "Créer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
