"use client";

import { useRef, useState, useTransition } from "react";
import { createTask, updateTask, deleteTask, type TaskActionResult } from "@/server/tasks/actions";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskPriority, TaskStatus } from "@prisma/client";

interface Option {
  id: string;
  label: string;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

export interface TaskFormInitial {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  assigneeId: string;
  clientId: string | null;
  prospectId: string | null;
  quoteId: string | null;
  appointmentId: string | null;
}

export interface TaskPrefill {
  kind: "client" | "prospect";
  id: string;
  label: string;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskForm({
  crmId,
  members,
  clients,
  prospects,
  quotes,
  appointments,
  currentUserId,
  task,
  prefill,
  onSuccess,
  onDeleted,
}: {
  crmId: string;
  members: Member[];
  clients: Option[];
  prospects: Option[];
  quotes: Option[];
  appointments: Option[];
  currentUserId: string;
  task?: TaskFormInitial;
  prefill?: TaskPrefill | null;
  onSuccess?: (taskId: string) => void;
  onDeleted?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultClientId = task?.clientId ?? (prefill?.kind === "client" ? prefill.id : "");
  const defaultProspectId = task?.prospectId ?? (prefill?.kind === "prospect" ? prefill.id : "");

  function submit() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setError(null);
    startTransition(async () => {
      const res: TaskActionResult = task ? await updateTask(crmId, task.id, fd) : await createTask(crmId, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      if (res.taskId) onSuccess?.(res.taskId);
    });
  }

  function handleDelete() {
    if (!task) return;
    if (!confirm("Supprimer cette tâche ?")) return;
    startTransition(async () => {
      const res = await deleteTask(crmId, task.id);
      if (!res.ok) {
        setError(res.error ?? "Impossible de supprimer cette tâche.");
        return;
      }
      onDeleted?.();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="title">Titre *</Label>
        <Input id="title" name="title" required defaultValue={task?.title} />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={task?.description ?? ""} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="assigneeId">Responsable *</Label>
          <Select id="assigneeId" name="assigneeId" required defaultValue={task?.assigneeId ?? currentUserId}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dueAt">Échéance</Label>
          <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={toDatetimeLocal(task?.dueAt ?? null)} />
        </div>
        <div>
          <Label htmlFor="priority">Priorité</Label>
          <Select id="priority" name="priority" defaultValue={task?.priority ?? "NORMAL"}>
            <option value="LOW">Basse</option>
            <option value="NORMAL">Normale</option>
            <option value="HIGH">Haute</option>
            <option value="URGENT">Urgente</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Statut</Label>
          <Select id="status" name="status" defaultValue={task?.status ?? "TODO"}>
            <option value="TODO">À faire</option>
            <option value="IN_PROGRESS">En cours</option>
            <option value="DONE">Terminée</option>
          </Select>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Lien vers (optionnel)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="clientId">Client</Label>
            <Select id="clientId" name="clientId" defaultValue={defaultClientId}>
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="prospectId">Prospect</Label>
            <Select id="prospectId" name="prospectId" defaultValue={defaultProspectId}>
              <option value="">—</option>
              {prospects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="quoteId">Devis</Label>
            <Select id="quoteId" name="quoteId" defaultValue={task?.quoteId ?? ""}>
              <option value="">—</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="appointmentId">Rendez-vous</Label>
            <Select id="appointmentId" name="appointmentId" defaultValue={task?.appointmentId ?? ""}>
              <option value="">—</option>
              {appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        {task ? (
          <Button type="button" variant="ghost" className="text-red-500" onClick={handleDelete} disabled={pending}>
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : task ? "Enregistrer" : "Créer la tâche"}
        </Button>
      </div>
    </form>
  );
}
