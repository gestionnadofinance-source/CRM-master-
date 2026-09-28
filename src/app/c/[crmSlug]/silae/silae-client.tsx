"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Download, Info, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createAbsence,
  createAcompte,
  deleteAbsence,
  deleteAcompte,
  generateSilaeExport,
  previewSilaeExport,
  updateSilaeMapping,
} from "@/server/silae/actions";
import type { SilaeReport } from "@/server/silae/report";

interface RubriqueRow {
  key: string;
  label: string;
  unit: "heures" | "montant" | "nombre";
  note: string | null;
}
interface MappingRow {
  rubrique: string;
  silaeCode: string;
  multiplier: number;
  exported: boolean;
}
interface EmployeeRow {
  id: string;
  name: string;
  matricule: string | null;
}
interface AcompteRow {
  id: string;
  employeeName: string;
  amount: number;
  paidOn: string;
  payrollMonth: string;
  comment: string | null;
}
interface AbsenceRow {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  days: number | null;
  comment: string | null;
}

const ABSENCE_LABELS: Record<string, string> = {
  CONGE_PAYE: "Congé payé",
  MALADIE: "Maladie",
  ABSENCE_INJUSTIFIEE: "Absence injustifiée",
  REPOS_COMPENSATEUR: "Repos compensateur",
  ACCIDENT_TRAVAIL: "Accident du travail",
  CONGE_SANS_SOLDE: "Congé sans solde",
  AUTRE: "Autre",
};

const TABS = ["Export", "Codes Silae", "Acomptes", "Absences"] as const;
type Tab = (typeof TABS)[number];

export function SilaeClient({
  crmId,
  rubriques,
  mappings,
  employees,
  defaultMonth,
  acomptes,
  absences,
}: {
  crmId: string;
  rubriques: RubriqueRow[];
  mappings: MappingRow[];
  employees: EmployeeRow[];
  defaultMonth: string;
  acomptes: AcompteRow[];
  absences: AbsenceRow[];
}) {
  const [tab, setTab] = useState<Tab>("Export");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium",
              tab === t ? "border-b-2 border-brand text-brand" : "text-muted hover:text-text"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Export" && <ExportSection crmId={crmId} defaultMonth={defaultMonth} />}
      {tab === "Codes Silae" && <MappingSection crmId={crmId} rubriques={rubriques} mappings={mappings} />}
      {tab === "Acomptes" && <AcompteSection crmId={crmId} employees={employees} acomptes={acomptes} defaultMonth={defaultMonth} />}
      {tab === "Absences" && <AbsenceSection crmId={crmId} employees={employees} absences={absences} />}
    </div>
  );
}

// --- Export ----------------------------------------------------------------

function ExportSection({ crmId, defaultMonth }: { crmId: string; defaultMonth: string }) {
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(defaultMonth);
  const [encoding, setEncoding] = useState<"win1252" | "utf8">("win1252");
  const [exportWorkedHours, setExportWorkedHours] = useState(false);
  const [report, setReport] = useState<SilaeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [year, monthNumber] = month.split("-").map(Number);

  function check() {
    setError(null);
    startTransition(async () => {
      const res = await previewSilaeExport(crmId, year!, monthNumber!, { exportWorkedHours, encoding });
      if (!res.ok) setError(res.error ?? "Échec de la vérification.");
      setReport(res.report ?? null);
    });
  }

  function download() {
    setError(null);
    startTransition(async () => {
      const res = await generateSilaeExport(crmId, year!, monthNumber!, { exportWorkedHours, encoding });
      setReport(res.report ?? null);
      if (!res.ok || !res.contentBase64 || !res.fileName) {
        setError(res.error ?? "Échec de la génération.");
        return;
      }
      // Le fichier est encodé côté serveur (Windows-1252 le plus souvent) :
      // on le restitue octet par octet, sans jamais le retraiter en texte —
      // un passage par une chaîne JavaScript le repasserait en UTF-16 et
      // ruinerait l'encodage.
      const binary = atob(res.contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Mois de paie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="month">Mois</Label>
              <Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="encoding">Encodage</Label>
              <Select id="encoding" value={encoding} onChange={(e) => setEncoding(e.target.value as "win1252" | "utf8")}>
                <option value="win1252">Windows-1252 (ANSI) — recommandé</option>
                <option value="utf8">UTF-8</option>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={exportWorkedHours}
                  onChange={(e) => setExportWorkedHours(e.target.checked)}
                  className="h-4 w-4"
                />
                Exporter les heures travaillées
              </label>
            </div>
          </div>
          <p className="text-xs text-muted">
            Les heures travaillées ne sont pas exportées par défaut : Silae calcule la base depuis le contrat. Ne les
            activez que si votre gestionnaire de paie le demande.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={check} disabled={pending || !month}>
              {pending ? "Calcul en cours..." : "Vérifier"}
            </Button>
            <Button type="button" onClick={download} disabled={pending || !month || (report?.blocking.length ?? 0) > 0}>
              <Download className="mr-1.5 h-4 w-4" />
              Télécharger le CSV
            </Button>
          </div>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {report && <ReportView report={report} />}
    </div>
  );
}

function ReportView({ report }: { report: SilaeReport }) {
  const totalLines = report.lineCount;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rapport de contrôle</CardTitle>
          <span className="text-xs text-muted">
            {report.employees.length} salarié(s) · {totalLines} ligne(s) dans le fichier
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.blocking.length > 0 && (
            <Alert tone="danger" title="À corriger avant de générer">
              {report.blocking.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </Alert>
          )}
          {report.warnings.length > 0 && (
            <Alert tone="warning" title="À vérifier">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </Alert>
          )}
          <Alert tone="info" title="Ne passe pas par cet import">
            {report.reminders.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </Alert>
        </CardContent>
      </Card>

      {report.employees.map((emp) => (
        <Card key={emp.userId}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{emp.name}</CardTitle>
            <span className="flex items-center gap-2 text-xs text-muted">
              {emp.matricule ? (
                <Badge variant="default">matricule {emp.matricule}</Badge>
              ) : (
                <Badge variant="danger">matricule manquant</Badge>
              )}
              <span className="tabular-nums">{emp.monthHours} h</span>
            </span>
          </CardHeader>
          <CardContent>
            {emp.lines.length === 0 ? (
              <p className="text-sm text-muted">Aucun élément à exporter ce mois-ci.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-1.5 pr-3 font-medium">Rubrique</th>
                      <th className="pb-1.5 pr-3 font-medium">Code Silae</th>
                      <th className="pb-1.5 pr-3 text-right font-medium">Valeur CRM</th>
                      <th className="pb-1.5 text-right font-medium">Exporté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.lines.map((l) => (
                      <tr key={l.rubrique} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-3 text-text">
                          {l.label} <span className="text-xs text-muted">({l.unit})</span>
                        </td>
                        <td className="py-1.5 pr-3">
                          {l.code ? (
                            <code className="text-xs text-text">{l.code}</code>
                          ) : (
                            <Badge variant="warning">sans code</Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{l.value}</td>
                        <td className="py-1.5 text-right tabular-nums text-text">
                          {l.exported && l.code ? l.exportedValue : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Alert({ tone, title, children }: { tone: "danger" | "warning" | "info"; title: string; children: React.ReactNode }) {
  const tones = {
    danger: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400",
    info: "border-border bg-bg-subtle text-muted",
  };
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("rounded-md border p-3 text-sm", tones[tone])}>
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-xs">{children}</ul>
    </div>
  );
}

// --- Codes Silae -----------------------------------------------------------

function MappingSection({
  crmId,
  rubriques,
  mappings,
}: {
  crmId: string;
  rubriques: RubriqueRow[];
  mappings: MappingRow[];
}) {
  const byKey = new Map(mappings.map((m) => [m.rubrique, m]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Correspondance rubrique CRM → code Silae</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert tone="warning" title="Un code faux ne produit aucune erreur">
          <li>
            Silae ignore silencieusement une ligne dont le code est inconnu : la valeur n&apos;arrive pas, sans message.
          </li>
          <li>
            Les codes doivent être strictement identiques aux intitulés de colonne de Silae (Paramétrage &gt; Variables
            à saisir), majuscules et minuscules comprises, avec leur préfixe.
          </li>
        </Alert>
        <div className="space-y-2">
          {rubriques.map((r) => (
            <MappingRowForm key={r.key} crmId={crmId} rubrique={r} mapping={byKey.get(r.key)} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MappingRowForm({ crmId, rubrique, mapping }: { crmId: string; rubrique: RubriqueRow; mapping?: MappingRow }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("exported", fd.get("exported") === "on" ? "true" : "false");
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateSilaeMapping(crmId, rubrique.key, fd);
      if (res.ok) setSaved(true);
      else setError(res.error ?? "Enregistrement impossible.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
        <div className="sm:col-span-4">
          <p className="text-sm font-medium text-text">{rubrique.label}</p>
          <p className="text-[11px] text-muted">{rubrique.unit}</p>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor={`code-${rubrique.key}`} className="text-[11px]">
            Code Silae
          </Label>
          <Input id={`code-${rubrique.key}`} name="silaeCode" defaultValue={mapping?.silaeCode ?? ""} className="h-8" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`mult-${rubrique.key}`} className="text-[11px]">
            Multiplicateur
          </Label>
          <Input
            id={`mult-${rubrique.key}`}
            name="multiplier"
            type="number"
            step="0.0001"
            min="0.0001"
            defaultValue={mapping?.multiplier ?? 1}
            className="h-8"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 pb-2 text-xs text-text">
            <input type="checkbox" name="exported" defaultChecked={mapping?.exported ?? true} className="h-4 w-4" />
            Exporter
          </label>
        </div>
        <div className="sm:col-span-1">
          <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-full">
            {pending ? "..." : saved ? "OK" : "Enreg."}
          </Button>
        </div>
      </div>
      {rubrique.note && <p className="mt-2 text-[11px] text-muted">{rubrique.note}</p>}
      {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </form>
  );
}

// --- Acomptes --------------------------------------------------------------

function AcompteSection({
  crmId,
  employees,
  acomptes,
  defaultMonth,
}: {
  crmId: string;
  employees: EmployeeRow[];
  acomptes: AcompteRow[];
  defaultMonth: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await createAcompte(crmId, fd);
      if (res.ok) form.reset();
      else setError(res.error ?? "Enregistrement impossible.");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Enregistrer un acompte</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Label htmlFor="ac-user">Salarié *</Label>
              <Select id="ac-user" name="userId" required defaultValue="">
                <option value="" disabled>
                  Choisir…
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ac-amount">Montant (€) *</Label>
              <Input id="ac-amount" name="amount" type="number" step="0.01" min="0.01" required />
            </div>
            <div>
              <Label htmlFor="ac-paid">Versé le *</Label>
              <Input id="ac-paid" name="paidOn" type="date" required />
            </div>
            <div>
              <Label htmlFor="ac-month">Mois de paie *</Label>
              <Input id="ac-month" name="payrollMonth" type="month" defaultValue={defaultMonth} required />
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="ac-comment">Commentaire</Label>
              <Input id="ac-comment" name="comment" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "..." : "Ajouter"}
              </Button>
            </div>
          </form>
          {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acomptes enregistrés</CardTitle>
        </CardHeader>
        <CardContent>
          {acomptes.length === 0 ? (
            <p className="text-sm text-muted">Aucun acompte enregistré.</p>
          ) : (
            <ul className="divide-y divide-border">
              {acomptes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-text">{a.employeeName}</span>{" "}
                    <span className="tabular-nums text-text">{a.amount.toFixed(2)} €</span>{" "}
                    <span className="text-muted">
                      · versé le {a.paidOn} · paie {a.payrollMonth}
                      {a.comment ? ` · ${a.comment}` : ""}
                    </span>
                  </span>
                  <DeleteButton label="Supprimer l'acompte" onDelete={() => deleteAcompte(crmId, a.id)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Absences --------------------------------------------------------------

function AbsenceSection({
  crmId,
  employees,
  absences,
}: {
  crmId: string;
  employees: EmployeeRow[];
  absences: AbsenceRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await createAbsence(crmId, fd);
      if (res.ok) form.reset();
      else setError(res.error ?? "Enregistrement impossible.");
    });
  }

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Saisie disponible, export à venir">
        <li>
          Les absences sont enregistrées ici de façon structurée, à la place des notes libres sous la ligne TOTAL du
          classeur Excel.
        </li>
        <li>
          Leur export vers Silae utilise des codes AB- et un format de fichier distinct, à récupérer auprès du
          gestionnaire de paie avant d&apos;être implémenté.
        </li>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Enregistrer une absence</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="ab-user">Salarié *</Label>
              <Select id="ab-user" name="userId" required defaultValue="">
                <option value="" disabled>
                  Choisir…
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ab-type">Type *</Label>
              <Select id="ab-type" name="type" required defaultValue="CONGE_PAYE">
                {Object.entries(ABSENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ab-start">Début *</Label>
              <Input id="ab-start" name="startDate" type="date" required />
            </div>
            <div>
              <Label htmlFor="ab-end">Fin *</Label>
              <Input id="ab-end" name="endDate" type="date" required />
            </div>
            <div>
              <Label htmlFor="ab-hours">Heures</Label>
              <Input id="ab-hours" name="hours" type="number" step="0.25" min="0" />
            </div>
            <div>
              <Label htmlFor="ab-days">Jours</Label>
              <Input id="ab-days" name="days" type="number" step="0.5" min="0" />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="ab-comment">Commentaire</Label>
              <Input id="ab-comment" name="comment" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "..." : "Ajouter"}
              </Button>
            </div>
          </form>
          {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Absences enregistrées</CardTitle>
        </CardHeader>
        <CardContent>
          {absences.length === 0 ? (
            <p className="text-sm text-muted">Aucune absence enregistrée.</p>
          ) : (
            <ul className="divide-y divide-border">
              {absences.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-text">{a.employeeName}</span>{" "}
                    <span className="text-text">{ABSENCE_LABELS[a.type] ?? a.type}</span>{" "}
                    <span className="text-muted">
                      · du {a.startDate} au {a.endDate}
                      {a.hours !== null ? ` · ${a.hours} h` : ""}
                      {a.days !== null ? ` · ${a.days} j` : ""}
                      {a.comment ? ` · ${a.comment}` : ""}
                    </span>
                  </span>
                  <DeleteButton label="Supprimer l'absence" onDelete={() => deleteAbsence(crmId, a.id)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteButton({ label, onDelete }: { label: string; onDelete: () => Promise<{ ok: boolean; error?: string }> }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      onClick={() => startTransition(async () => void (await onDelete()))}
      className="shrink-0 rounded-md p-1.5 text-muted hover:bg-bg-subtle hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
