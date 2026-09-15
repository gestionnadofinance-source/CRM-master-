"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Mail, Lock, Loader2, Trash2 } from "lucide-react";
import {
  listChantierRosterForWeek,
  emailClientTimesheet,
  depositClientTimesheet,
  listTimesheetDepositsForWeek,
  deleteTimesheetDocument,
} from "@/server/pointage/actions";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type Chantier = { id: string; name: string; address: string | null; startDate: Date; endDate: Date };
type RosterData = Awaited<ReturnType<typeof listChantierRosterForWeek>>;
type Deposit = Awaited<ReturnType<typeof listTimesheetDepositsForWeek>>[number];

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function mondayOfClient(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function formatDateFr(d: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

function dayTotal(d: { normal: number; matin: number; apresMidi: number; nuit: number }): number {
  return d.normal + d.matin + d.apresMidi + d.nuit;
}

export function PointageClientSheetClient({ crmId, chantiers }: { crmId: string; chantiers: Chantier[] }) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id ?? "");
  const [weekAnchor, setWeekAnchor] = useState(() => mondayOfClient(new Date()));
  const [data, setData] = useState<RosterData | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const chantier = chantiers.find((c) => c.id === chantierId);

  async function refresh() {
    if (!chantierId) return;
    setLoading(true);
    const [res, dep] = await Promise.all([
      listChantierRosterForWeek(crmId, chantierId, weekAnchor.toISOString()),
      listTimesheetDepositsForWeek(crmId, chantierId, weekAnchor.toISOString()),
    ]);
    setData(res);
    setDeposits(dep);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crmId, chantierId, weekAnchor]);

  function handleDeleteDeposit(doc: Deposit) {
    if (!confirm(`Supprimer "${doc.fileName}" du coffre-fort ? Cette action est irréversible.`)) return;
    startTransition(async () => {
      await deleteTimesheetDocument(crmId, doc.id);
      await refresh();
    });
  }

  useEffect(() => {
    if (chantier) setFolderName(`${formatDateFr(weekAnchor)} — ${chantier.name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierId, weekAnchor]);

  function shiftWeek(delta: number) {
    const next = new Date(weekAnchor);
    next.setUTCDate(next.getUTCDate() + delta * 7);
    setWeekAnchor(next);
  }

  const weekEnd = new Date(weekAnchor);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const roster = data?.roster.filter((r) => r.hasEntry) ?? [];

  function handleEmail() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const res = await emailClientTimesheet(crmId, chantierId, weekAnchor.toISOString());
      if (!res.ok) setError(res.error ?? "Erreur lors de l'envoi.");
      else setNotice("Fiche client envoyée par email.");
    });
  }

  function handleDeposit() {
    setNotice(null);
    setError(null);
    if (!folderName.trim()) {
      setError("Donnez un nom au dossier avant de déposer.");
      return;
    }
    startTransition(async () => {
      const res = await depositClientTimesheet(crmId, chantierId, weekAnchor.toISOString(), folderName);
      if (!res.ok) {
        setError(res.error ?? "Erreur lors du dépôt.");
        return;
      }
      setNotice("Fiche client déposée dans votre coffre-fort.");
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          {chantiers.length > 1 ? (
            <Select value={chantierId} onChange={(e) => setChantierId(e.target.value)} className="w-56">
              {chantiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm font-medium text-text">{chantiers[0]?.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => shiftWeek(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm text-text">
            Semaine du {formatDateFr(weekAnchor)} au {formatDateFr(weekEnd)}
          </p>
          <Button variant="ghost" size="sm" onClick={() => shiftWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {loading || !data ? (
        <p className="py-8 text-center text-sm text-muted">Chargement...</p>
      ) : roster.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          Aucune heure saisie pour cette semaine sur ce chantier. Remplissez d&apos;abord la feuille de pointage
          salariés.
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle text-xs text-muted">
                  <th className="px-3 py-2 text-left">Salarié</th>
                  {DAY_LABELS.map((l) => (
                    <th key={l} className="px-2 py-2 text-center">
                      {l}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.employeeId} className="border-b border-border/60">
                    <td className="px-3 py-2 text-text">
                      {r.firstName} {r.lastName}
                    </td>
                    {r.days.map((d) => (
                      <td key={d.date} className="px-2 py-2 text-center text-text">
                        {dayTotal(d) || ""}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-medium text-text">{r.totals.totalHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <Label className="text-xs">Nom du dossier (coffre-fort)</Label>
              <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Ex : Chantier X — semaine du..." />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={isPending} onClick={handleEmail}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Envoyer par email
              </Button>
              <Button disabled={isPending} onClick={handleDeposit}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Déposer au coffre-fort
              </Button>
            </div>
            {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </Card>
        </>
      )}

      {deposits.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium text-text">Fiches déjà déposées au coffre-fort cette semaine</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {deposits.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">
                    {doc.fileName}
                    {doc.employeeName && <span className="text-muted"> — {doc.employeeName}</span>}
                  </p>
                </div>
                <button
                  disabled={isPending}
                  onClick={() => handleDeleteDeposit(doc)}
                  className="shrink-0 text-muted hover:text-red-500"
                  title="Supprimer (dépôt fait par erreur)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
