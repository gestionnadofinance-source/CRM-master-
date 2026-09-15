"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { formatDate } from "@/lib/utils";
import { setTaskStatus } from "@/server/tasks/actions";
import { TaskForm, type TaskFormInitial, type TaskPrefill } from "./task-form";
import { TaskPriority, TaskStatus } from "@prisma/client";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
}

interface Option {
  id: string;
  label: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  assignee: { id: string; firstName: string; lastName: string; color: string };
  clientId: string | null;
  clientName: string | null;
  prospectId: string | null;
  prospectName: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  appointmentId: string | null;
  appointmentTitle: string | null;
  isAutomated: boolean;
}

const PRIORITY_VARIANT: Record<TaskPriority, "default" | "warning" | "danger"> = {
  LOW: "default",
  NORMAL: "default",
  HIGH: "warning",
  URGENT: "danger",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
};

type ModalState = "closed" | "new" | { taskId: string };

/**
 * Partie interactive de la page Tâches : liste, case "terminée" rapide,
 * modale de création/édition (ouverte automatiquement via `?task=<id>`,
 * `?newForClient=<id>` ou `?newForProspect=<id>`), et rafraîchissement
 * temps réel sur l'événement `task.upserted`.
 */
export function TasksClient({
  crmId,
  crmSlug,
  currentUserId,
  members,
  clients,
  prospects,
  quotes,
  appointments,
  tasks,
  openTask,
  prefill,
}: {
  crmId: string;
  crmSlug: string;
  currentUserId: string;
  members: Member[];
  clients: { id: string; company: string }[];
  prospects: { id: string; company: string }[];
  quotes: Option[];
  appointments: Option[];
  tasks: TaskRow[];
  openTask: TaskFormInitial | null;
  prefill: TaskPrefill | null;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>("closed");
  const [, startTransition] = useTransition();

  const clientOptions: Option[] = clients.map((c) => ({ id: c.id, label: c.company }));
  const prospectOptions: Option[] = prospects.map((p) => ({ id: p.id, label: p.company }));

  useRealtimeChannel(`private-crm-${crmId}`, {
    "task.upserted": () => router.refresh(),
  });

  useEffect(() => {
    if (openTask) setModal({ taskId: openTask.id });
    else if (prefill) setModal("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTask?.id, prefill?.id]);

  function closeModal() {
    setModal("closed");
    router.push(`/c/${crmSlug}/tasks`);
  }

  function openEdit(taskId: string) {
    setModal({ taskId });
    router.push(`/c/${crmSlug}/tasks?task=${taskId}`);
  }

  function openNew() {
    setModal("new");
    router.push(`/c/${crmSlug}/tasks`);
  }

  function toggleDone(t: TaskRow) {
    const next: TaskStatus = t.status === "DONE" ? "TODO" : "DONE";
    startTransition(async () => {
      await setTaskStatus(crmId, t.id, next);
      router.refresh();
    });
  }

  function findEditingTask(taskId: string): TaskFormInitial | null {
    const fromList = tasks.find((t) => t.id === taskId);
    if (fromList) {
      return {
        id: fromList.id,
        title: fromList.title,
        description: fromList.description,
        priority: fromList.priority,
        status: fromList.status,
        dueAt: fromList.dueAt,
        assigneeId: fromList.assignee.id,
        clientId: fromList.clientId,
        prospectId: fromList.prospectId,
        quoteId: fromList.quoteId,
        appointmentId: fromList.appointmentId,
      };
    }
    if (openTask && openTask.id === taskId) return openTask;
    return null;
  }

  const editingTask = typeof modal === "object" ? findEditingTask(modal.taskId) : null;
  const modalOpen = modal !== "closed";

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nouvelle tâche
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Terminée</th>
                <th className="px-4 py-2.5 font-medium">Tâche</th>
                <th className="px-4 py-2.5 font-medium">Responsable</th>
                <th className="px-4 py-2.5 font-medium">Priorité</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium">Échéance</th>
                <th className="px-4 py-2.5 font-medium">Lié à</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map((t) => {
                const overdue = t.dueAt ? t.status !== "DONE" && new Date(t.dueAt) < new Date() : false;
                return (
                  <tr key={t.id} className="cursor-pointer hover:bg-bg-subtle" onClick={() => openEdit(t.id)}>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={t.status === "DONE"}
                        onChange={() => toggleDone(t)}
                        className="h-4 w-4 rounded border-border"
                        aria-label="Marquer comme terminée"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`font-medium ${t.status === "DONE" ? "text-muted line-through" : "text-text"}`}>
                        {t.title}
                      </span>
                      {t.isAutomated && (
                        <Badge variant="brand" className="ml-2">
                          Auto
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {t.assignee.firstName} {t.assignee.lastName}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={PRIORITY_VARIANT[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{STATUS_LABEL[t.status]}</td>
                    <td className={`px-4 py-2.5 ${overdue ? "text-red-500" : "text-muted"}`}>
                      {t.dueAt ? formatDate(t.dueAt, true) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {t.clientName ?? t.prospectName ?? t.quoteNumber ?? t.appointmentTitle ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Aucune tâche ne correspond à ces critères.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modalOpen && (
        <Modal open onClose={closeModal} title={editingTask ? "Modifier la tâche" : "Nouvelle tâche"} width="lg">
          <TaskForm
            crmId={crmId}
            members={members}
            clients={clientOptions}
            prospects={prospectOptions}
            quotes={quotes}
            appointments={appointments}
            currentUserId={currentUserId}
            task={editingTask ?? undefined}
            prefill={editingTask ? null : prefill}
            onSuccess={() => closeModal()}
            onDeleted={() => closeModal()}
          />
        </Modal>
      )}
    </>
  );
}
