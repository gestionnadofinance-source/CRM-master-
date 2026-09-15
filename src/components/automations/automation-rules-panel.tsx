"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import {
  listAutomationRules,
  createAutomationRule,
  updateAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
  runNoActivitySweepNow,
} from "@/server/automations/actions";
import { Pencil, Trash2, Zap } from "lucide-react";

type AutomationTrigger = "QUOTE_SENT" | "APPOINTMENT_COMPLETED" | "PROSPECT_CONVERTED" | "CLIENT_CREATED" | "NO_ACTIVITY_SINCE";
type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface RuleAction {
  id: string;
  type: string;
  config: unknown;
}

interface Rule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  delayDays: number;
  isActive: boolean;
  actions: RuleAction[];
}

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  QUOTE_SENT: "Devis envoyé",
  APPOINTMENT_COMPLETED: "Rendez-vous terminé",
  PROSPECT_CONVERTED: "Prospect converti",
  CLIENT_CREATED: "Client créé",
  NO_ACTIVITY_SINCE: "Sans activité depuis",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

interface CreateTaskConfig {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignTo?: "OWNER" | "CREATOR";
  dueInDays?: number;
}

function getConfig(rule: Rule): CreateTaskConfig {
  const action = rule.actions.find((a) => a.type === "CREATE_TASK");
  return (action?.config as CreateTaskConfig) ?? {};
}

/**
 * Panneau d'administration des règles d'automatisation d'un CRM. Composant
 * réutilisable, autonome (charge et rafraîchit ses propres données) — conçu
 * pour être importé et embarqué dans la page `/c/[crmSlug]/settings` par le
 * module Administration. N'est PAS une route en soi.
 *
 * Accès : réservé aux utilisateurs Permission.MANAGE_SETTINGS (vérifié côté
 * serveur dans chaque server action ; ce composant ne fait aucune vérité de
 * permission côté client).
 */
export function AutomationRulesPanel({ crmId }: { crmId: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    try {
      const data = await listAutomationRules(crmId);
      setRules(data as unknown as Rule[]);
      setError(null);
    } catch {
      setError("Impossible de charger les règles d'automatisation (accès réservé aux administrateurs).");
      setRules([]);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crmId]);

  function handleToggle(rule: Rule) {
    startTransition(async () => {
      await toggleAutomationRule(crmId, rule.id, !rule.isActive);
      await refresh();
    });
  }

  function handleDelete(rule: Rule) {
    if (!confirm(`Supprimer la règle « ${rule.name} » ?`)) return;
    startTransition(async () => {
      await deleteAutomationRule(crmId, rule.id);
      await refresh();
    });
  }

  function handleRunSweep() {
    setSweepResult(null);
    startTransition(async () => {
      const res = await runNoActivitySweepNow(crmId);
      if (res.ok) {
        setSweepResult(`Balayage effectué : ${res.tasksCreated} tâche(s) de relance créée(s).`);
        await refresh();
      } else {
        setSweepResult(res.error ?? "Échec du balayage.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Règles d&apos;automatisation</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRunSweep} disabled={isPending}>
            <Zap className="h-4 w-4" />
            Lancer le balayage &laquo; sans activité &raquo;
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            Nouvelle règle
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sweepResult && <p className="rounded-md bg-bg-subtle px-3 py-2 text-sm text-text">{sweepResult}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {rules === null && <p className="text-sm text-muted">Chargement…</p>}
        {rules !== null && rules.length === 0 && !error && (
          <p className="text-sm text-muted">
            Aucune règle configurée. Suggestions : « Devis envoyé → tâche de relance +5 jours », « Rendez-vous
            terminé → tâche de compte rendu +0 jour », « Prospect converti → tâche de suivi +2 jours », « Client
            créé → tâche de suivi +1 jour ».
          </p>
        )}
        <ul className="divide-y divide-border">
          {rules?.map((rule) => {
            const config = getConfig(rule);
            return (
              <li key={rule.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-text">{rule.name}</p>
                    <Badge variant={rule.isActive ? "success" : "default"}>{rule.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {TRIGGER_LABELS[rule.trigger]} · délai {rule.delayDays}j · tâche « {config.title ?? "—"} »
                    {config.priority ? ` · ${PRIORITY_LABELS[config.priority]}` : ""}
                    {config.assignTo ? ` · assigné : ${config.assignTo === "OWNER" ? "propriétaire" : "acteur"}` : ""}
                    {config.dueInDays ? ` · +${config.dueInDays}j` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(rule)} disabled={isPending}>
                    {rule.isActive ? "Désactiver" : "Activer"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(rule)} aria-label="Modifier">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(rule)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>

      {editing !== null && (
        <RuleFormModal
          crmId={crmId}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </Card>
  );
}

function RuleFormModal({
  crmId,
  rule,
  onClose,
  onSaved,
}: {
  crmId: string;
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const config = rule ? getConfig(rule) : {};
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    setError(null);
    startTransition(async () => {
      const res = rule
        ? await updateAutomationRule(crmId, rule.id, formData)
        : await createAutomationRule(crmId, formData);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        return;
      }
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={rule ? "Modifier la règle" : "Nouvelle règle d'automatisation"} width="md">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-4"
      >
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

        <div>
          <Label htmlFor="name">Nom de la règle</Label>
          <Input id="name" name="name" required defaultValue={rule?.name} placeholder="Ex : Devis envoyé → relance" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="trigger">Déclencheur</Label>
            <Select id="trigger" name="trigger" defaultValue={rule?.trigger ?? "QUOTE_SENT"} required>
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="delayDays">Délai avant la tâche (jours)</Label>
            <Input
              id="delayDays"
              name="delayDays"
              type="number"
              min={0}
              required
              defaultValue={rule?.delayDays ?? 0}
            />
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Action : créer une tâche</p>

          <div className="space-y-3">
            <div>
              <Label htmlFor="actionTitle">Titre de la tâche</Label>
              <Input
                id="actionTitle"
                name="actionTitle"
                required
                defaultValue={config.title}
                placeholder="Ex : Relancer le client"
              />
            </div>
            <div>
              <Label htmlFor="actionDescription">Description (optionnelle)</Label>
              <Textarea id="actionDescription" name="actionDescription" defaultValue={config.description} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="actionPriority">Priorité</Label>
                <Select id="actionPriority" name="actionPriority" defaultValue={config.priority ?? "NORMAL"}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="actionAssignTo">Assigner à</Label>
                <Select id="actionAssignTo" name="actionAssignTo" defaultValue={config.assignTo ?? "OWNER"}>
                  <option value="OWNER">Propriétaire de l&apos;entité</option>
                  <option value="CREATOR">Acteur de l&apos;événement</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="actionDueInDays">Délai additionnel (jours)</Label>
                <Input
                  id="actionDueInDays"
                  name="actionDueInDays"
                  type="number"
                  min={0}
                  defaultValue={config.dueInDays ?? 0}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
