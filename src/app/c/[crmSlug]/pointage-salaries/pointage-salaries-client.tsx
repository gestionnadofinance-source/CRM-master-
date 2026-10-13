"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Pencil, Mail, Lock, Loader2, Trash2 } from "lucide-react";
import {
  listChantierRosterForWeek,
  upsertPointageEntry,
  emailEmployeeTimesheets,
  depositEmployeeTimesheets,
  listTimesheetDepositsForWeek,
  deleteTimesheetDocument,
} from "@/server/pointage/actions";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Label } from "@/components/ui/input";
import { Card, Badge } from "@/components/ui/card";
import { initials } from "@/lib/utils";

type Chantier = { id: string; name: string; address: string | null; startDate: Date; endDate: Date };
type RosterData = Awaited<ReturnType<typeof listChantierRosterForWeek>>;
type RosterEntry = RosterData["roster"][number];
type Deposit = Awaited<ReturnType<typeof listTimesheetDepositsForWeek>>[number];

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const HOUR_FIELDS = [
  { key: "normal", label: "Normal" },
  { key: "matin", label: "Matin" },
  { key: "apresMidi", label: "Après-midi" },
  { key: "nuit", label: "Nuit" },
] as const;

function mondayOfClient(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function formatEur(v: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
}

function formatDateFr(d: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

export function PointageSalariesClient({ crmId, chantiers }: { crmId: string; chantiers: Chantier[] }) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id ?? "");
  const [weekAnchor, setWeekAnchor] = useState(() => mondayOfClient(new Date()));
  const [data, setData] = useState<RosterData | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RosterEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeHasFailures, setNoticeHasFailures] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  function handleDeleteDeposit(doc: Deposit) {
    if (!confirm(`Supprimer "${doc.fileName}" du coffre-fort ? Cette action est irréversible.`)) return;
    startTransition(async () => {
      await deleteTimesheetDocument(crmId, doc.id);
      await refresh();
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierId, weekAnchor]);

  function shiftWeek(delta: number) {
    const next = new Date(weekAnchor);
    next.setUTCDate(next.getUTCDate() + delta * 7);
    setWeekAnchor(next);
  }

  const weekEnd = new Date(weekAnchor);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const filledCount = data?.roster.filter((r) => r.hasEntry).length ?? 0;

  function handleSaveEntry(fd: FormData) {
    if (!editing || !data) return;
    setError(null);
    startTransition(async () => {
      const res = await upsertPointageEntry(crmId, chantierId, fd);
      if (!res.ok) {
        setError(res.error ?? "Erreur lors de l'enregistrement.");
        return;
      }
      setEditing(null);
      await refresh();
    });
  }

  function failureSuffix(failedEmployees?: string[]) {
    if (!failedEmployees || failedEmployees.length === 0) return "";
    return ` — échec pour : ${failedEmployees.join(", ")} (à relancer).`;
  }

  function handleEmail() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const res = await emailEmployeeTimesheets(crmId, chantierId, weekAnchor.toISOString());
      if (!res.ok) {
        setError(res.error ?? "Erreur lors de l'envoi.");
        return;
      }
      setNoticeHasFailures(!!res.failedEmployees?.length);
      setNotice(`Fiches envoyées par email.${failureSuffix(res.failedEmployees)}`);
    });
  }

  function handleDeposit() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof depositEmployeeTimesheets>>;
      try {
        res = await depositEmployeeTimesheets(crmId, chantierId, weekAnchor.toISOString());
      } catch {
        // Pas de réponse exploitable (délai dépassé, coupure réseau) : sans ce
        // rattrapage, l'exception remplace toute la page par un écran
        // d'erreur, et le chef ne sait pas ce qui a été déposé.
        setError(
          "Le serveur n'a pas répondu à temps. Une partie des fiches a pu être déposée : vérifiez la liste des fiches déjà déposées avant de relancer."
        );
        await refresh().catch(() => setLoading(false));
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Erreur lors du dépôt.");
        await refresh().catch(() => setLoading(false));
        return;
      }
      setNoticeHasFailures(!!res.failedEmployees?.length);
      setNotice(`Fiches déposées dans le coffre-fort de chaque salarié.${failureSuffix(res.failedEmployees)}`);
      await refresh().catch(() => setLoading(false));
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
      ) : data.roster.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">Aucun ouvrier affecté à ce chantier (voir Planning).</Card>
      ) : (
        <Card className="divide-y divide-border">
          {data.roster.map((entry) => (
            <div key={entry.employeeId} className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: entry.color }}
              >
                {initials(entry.firstName, entry.lastName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text">
                    {entry.firstName} {entry.lastName}
                  </p>
                  {entry.isForeman && <Badge variant="brand">Chef de chantier</Badge>}
                  {entry.hasEntry && <Badge variant="success">Saisi</Badge>}
                </div>
                <p className="text-xs text-muted">
                  {entry.totals.totalHours} h · {formatEur(entry.totals.grandTotal)} de frais
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(entry)}>
                <Pencil className="h-3.5 w-3.5" /> {entry.hasEntry ? "Modifier" : "Saisir"}
              </Button>
            </div>
          ))}
        </Card>
      )}

      {data && data.roster.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {filledCount} fiche{filledCount > 1 ? "s" : ""} saisie{filledCount > 1 ? "s" : ""} sur {data.roster.length}.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={isPending || filledCount === 0} onClick={handleEmail}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Envoyer par email
            </Button>
            <Button disabled={isPending || filledCount === 0} onClick={handleDeposit}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Déposer au coffre-fort
            </Button>
          </div>
        </Card>
      )}
      {notice && (
        <p className={noticeHasFailures ? "text-sm text-amber-800 dark:text-amber-400" : "text-sm text-emerald-700 dark:text-emerald-400"}>
          {notice}
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Pointage — ${editing.firstName} ${editing.lastName}` : ""}
        width="xl"
      >
        {editing && data && (
          <EntryForm
            key={editing.employeeId}
            entry={editing}
            weekStartIso={data.weekStart}
            error={error}
            isPending={isPending}
            onSubmit={handleSaveEntry}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function EntryForm({
  entry,
  weekStartIso,
  error,
  isPending,
  onSubmit,
  onCancel,
}: {
  entry: RosterEntry;
  weekStartIso: string;
  error: string | null;
  isPending: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [days, setDays] = useState(entry.days);
  // Logement (euros), salissure (case) et nombres de repas : propres à la fiche.
  const [primes, setPrimes] = useState(entry.primes);
  // Grands déplacements : un NOMBRE par barème, pas un montant — Silae
  // applique lui-même le barème (voir src/server/silae/rubriques.ts).
  const [grandsDeplacements, setGrandsDeplacements] = useState(entry.grandsDeplacements);
  // Le taux horaire n'arrive dans le navigateur que pour l'administration et
  // les profils de paie : le chef de chantier ne le voit ni ne le modifie.
  const canSeeRates = entry.canSeeRates;
  const [hourlyRate, setHourlyRate] = useState(entry.rates.hourlyRate ?? 0);
  const [nightRatePercent, setNightRatePercent] = useState(entry.rates.nightRatePercent);
  // Cases à cocher : le montant vient du chantier ou de l'affectation —
  // jamais saisi ici. Rien n'est pré-coché par défaut, c'est au chef de
  // chantier de choisir.
  const [applied, setApplied] = useState(entry.applied);
  const [housingChecked, setHousingChecked] = useState(entry.primes.housingAllowance > 0);
  const [comments, setComments] = useState(entry.comments);

  function setHour(dayIndex: number, field: (typeof HOUR_FIELDS)[number]["key"], value: string) {
    setDays((prev) => prev.map((d, i) => (i === dayIndex ? { ...d, [field]: Number(value) || 0 } : d)));
  }

  function toggle(key: keyof typeof applied) {
    setApplied((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const totalNuit = days.reduce((s, d) => s + (d.nuit || 0), 0);
  const daysWorked = days.filter((d) => d.normal + d.matin + d.apresMidi + d.nuit > 0).length;
  // Nombre de repas : celui choisi, plafonné aux jours travaillés ; une
  // fiche antérieure à ce choix (null) compte un repas par jour travaillé.
  const lunchCount = applied.lunchAllowanceApplied ? Math.min(primes.lunchCount ?? daysWorked, daysWorked) : 0;
  const dinnerCount = applied.dinnerAllowanceApplied ? Math.min(primes.dinnerCount ?? daysWorked, daysWorked) : 0;

  function toggleMeal(key: "lunchAllowanceApplied" | "dinnerAllowanceApplied", countKey: "lunchCount" | "dinnerCount") {
    // Cocher propose un repas par jour travaillé, modifiable ensuite.
    if (!applied[key]) setPrimes((prev) => ({ ...prev, [countKey]: daysWorked }));
    toggle(key);
  }

  const nightBonus = canSeeRates ? totalNuit * hourlyRate * (nightRatePercent / 100) : 0;
  const lunchTotal = lunchCount * entry.chantierAmounts.lunchAllowance;
  const dinnerTotal = dinnerCount * entry.chantierAmounts.dinnerAllowance;
  const travelTotal = applied.travelAllowanceApplied ? daysWorked * entry.chantierAmounts.travelAllowance : 0;
  const kmTotal = applied.kmReimbursementApplied
    ? daysWorked * entry.assignmentRates.distanceKm * entry.assignmentRates.kmRate
    : 0;
  const travelHoursTotal = applied.travelHoursReimbursementApplied
    ? daysWorked * entry.assignmentRates.travelDurationHours * entry.assignmentRates.travelHourlyRate
    : 0;
  // Masque, zone, poste et management : par jour travaillé.
  const maskTotal = applied.maskBonusApplied ? daysWorked * entry.chantierAmounts.maskBonus : 0;
  const managementTotal =
    canSeeRates && applied.managementBonusApplied ? daysWorked * (Math.round(hourlyRate * 50) / 100) : 0;
  const zoneTotal = applied.zoneBonusApplied ? daysWorked * entry.chantierAmounts.zoneBonus : 0;
  const postTotal = applied.postBonusApplied ? daysWorked * entry.chantierAmounts.postBonus : 0;
  const mealTotal = applied.mealAllowanceApplied ? daysWorked * entry.chantierAmounts.mealAllowance : 0;
  const housing = housingChecked ? primes.housingAllowance : 0;
  const indemnitiesTotal = lunchTotal + dinnerTotal + travelTotal + kmTotal + travelHoursTotal + mealTotal;
  // Habillage et salissure sont des unités : ils n'entrent pas dans les euros.
  const primesTotal = housing + maskTotal + managementTotal + zoneTotal + postTotal;
  const unites = [
    applied.clothingBonusApplied ? "habillage 1" : null,
    primes.dirtAllowanceApplied ? "salissure 1" : null,
  ].filter(Boolean);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("employeeId", entry.employeeId);
    fd.set("weekStart", weekStartIso);
    fd.set("days", JSON.stringify(days));
    fd.set("housingAllowance", String(housing));
    fd.set("dirtAllowanceApplied", String(primes.dirtAllowanceApplied));
    if (applied.lunchAllowanceApplied) fd.set("lunchCount", String(lunchCount));
    if (applied.dinnerAllowanceApplied) fd.set("dinnerCount", String(dinnerCount));
    // Jamais envoyé par le chef de chantier — et ignoré par le serveur s'il l'était.
    if (canSeeRates) fd.set("hourlyRate", String(hourlyRate));
    fd.set("nightRatePercent", String(nightRatePercent));
    fd.set("lunchAllowanceApplied", String(applied.lunchAllowanceApplied));
    fd.set("dinnerAllowanceApplied", String(applied.dinnerAllowanceApplied));
    fd.set("travelAllowanceApplied", String(applied.travelAllowanceApplied));
    fd.set("maskBonusApplied", String(applied.maskBonusApplied));
    fd.set("managementBonusApplied", String(applied.managementBonusApplied));
    fd.set("zoneBonusApplied", String(applied.zoneBonusApplied));
    fd.set("postBonusApplied", String(applied.postBonusApplied));
    fd.set("kmReimbursementApplied", String(applied.kmReimbursementApplied));
    fd.set("travelHoursReimbursementApplied", String(applied.travelHoursReimbursementApplied));
    fd.set("mealAllowanceApplied", String(applied.mealAllowanceApplied));
    fd.set("clothingBonusApplied", String(applied.clothingBonusApplied));
    fd.set("gdDepl53Count", String(grandsDeplacements.gdDepl53Count));
    fd.set("gdDepl80Count", String(grandsDeplacements.gdDepl80Count));
    fd.set("comments", comments);
    onSubmit(fd);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-1.5 pr-2">Jour</th>
              {HOUR_FIELDS.map((f) => (
                <th key={f.key} className="px-1.5 py-1.5 text-center">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.date} className="border-b border-border/60">
                <td className="py-1.5 pr-2 text-xs text-text">
                  {DAY_LABELS[i]} <span className="text-muted">{formatDateFr(d.date)}</span>
                </td>
                {HOUR_FIELDS.map((f) => (
                  <td key={f.key} className="px-1.5 py-1">
                    <Input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={d[f.key] || ""}
                      onChange={(e) => setHour(i, f.key, e.target.value)}
                      className="h-8 text-center"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4">
        {canSeeRates && (
          <div>
            <Label className="text-xs">Taux horaire de base (€)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Number(e.target.value) || 0)}
              className="max-w-[180px]"
            />
          </div>
        )}
        <div>
          <Label className="text-xs">Majoration nuit (% — laisser à 0 pour ne rien facturer)</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={nightRatePercent}
            onChange={(e) => setNightRatePercent(Number(e.target.value) || 0)}
            className="max-w-[180px]"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-text">Indemnités du chantier (cocher celles qui s&apos;appliquent)</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CountCheckboxRow
            label="Repas midi"
            amount={entry.chantierAmounts.lunchAllowance > 0 ? `${formatEur(entry.chantierAmounts.lunchAllowance)}/repas` : "non configuré sur le chantier"}
            checked={applied.lunchAllowanceApplied}
            disabled={entry.chantierAmounts.lunchAllowance === 0}
            onChange={() => toggleMeal("lunchAllowanceApplied", "lunchCount")}
            count={lunchCount}
            max={daysWorked}
            onCountChange={(n) => setPrimes({ ...primes, lunchCount: n })}
          />
          <CountCheckboxRow
            label="Repas soir"
            amount={entry.chantierAmounts.dinnerAllowance > 0 ? `${formatEur(entry.chantierAmounts.dinnerAllowance)}/repas` : "non configuré sur le chantier"}
            checked={applied.dinnerAllowanceApplied}
            disabled={entry.chantierAmounts.dinnerAllowance === 0}
            onChange={() => toggleMeal("dinnerAllowanceApplied", "dinnerCount")}
            count={dinnerCount}
            max={daysWorked}
            onCountChange={(n) => setPrimes({ ...primes, dinnerCount: n })}
          />
          <CheckboxRow
            label="Grand déplacement"
            amount={entry.chantierAmounts.travelAllowance > 0 ? `${formatEur(entry.chantierAmounts.travelAllowance)}/jour` : "non configuré sur le chantier"}
            checked={applied.travelAllowanceApplied}
            disabled={entry.chantierAmounts.travelAllowance === 0}
            onChange={() => toggle("travelAllowanceApplied")}
          />
          <CheckboxRow
            label="Frais kilométriques"
            amount={
              entry.assignmentRates.distanceKm > 0 && entry.assignmentRates.kmRate > 0
                ? `${entry.assignmentRates.distanceKm} km × ${formatEur(entry.assignmentRates.kmRate)}`
                : "non configuré sur l'affectation"
            }
            checked={applied.kmReimbursementApplied}
            disabled={entry.assignmentRates.distanceKm === 0 || entry.assignmentRates.kmRate === 0}
            onChange={() => toggle("kmReimbursementApplied")}
          />
          <CheckboxRow
            label="Heures de trajet"
            amount={
              entry.assignmentRates.travelDurationHours > 0 && entry.assignmentRates.travelHourlyRate > 0
                ? `${entry.assignmentRates.travelDurationHours} h × ${formatEur(entry.assignmentRates.travelHourlyRate)}`
                : "non configuré sur l'affectation"
            }
            checked={applied.travelHoursReimbursementApplied}
            disabled={entry.assignmentRates.travelDurationHours === 0 || entry.assignmentRates.travelHourlyRate === 0}
            onChange={() => toggle("travelHoursReimbursementApplied")}
          />
          <CheckboxRow
            label="Repas"
            amount={entry.chantierAmounts.mealAllowance > 0 ? `${formatEur(entry.chantierAmounts.mealAllowance)}/jour` : "non configuré sur le chantier"}
            checked={applied.mealAllowanceApplied}
            disabled={entry.chantierAmounts.mealAllowance === 0}
            onChange={() => toggle("mealAllowanceApplied")}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-text">Primes</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <AmountCheckboxRow
            label="Prime logement"
            hint="1 fois / semaine"
            checked={housingChecked}
            onChange={() => setHousingChecked(!housingChecked)}
            amount={primes.housingAllowance}
            onAmountChange={(v) => setPrimes({ ...primes, housingAllowance: v })}
          />
          <CheckboxRow
            label="Prime salissure"
            amount="1 unité / semaine"
            checked={primes.dirtAllowanceApplied}
            disabled={false}
            onChange={() => setPrimes({ ...primes, dirtAllowanceApplied: !primes.dirtAllowanceApplied })}
          />
          <CheckboxRow
            label="Prime habillage"
            amount="1 unité / semaine"
            checked={applied.clothingBonusApplied}
            disabled={false}
            onChange={() => toggle("clothingBonusApplied")}
          />
          <CheckboxRow
            label="Prime management"
            amount={
              canSeeRates
                ? `50 % du taux horaire/jour (${formatEur(Math.round(hourlyRate * 50) / 100)})`
                : "50 % du taux horaire/jour, calculée automatiquement"
            }
            checked={applied.managementBonusApplied}
            disabled={false}
            onChange={() => toggle("managementBonusApplied")}
          />
          <CheckboxRow
            label="Prime de zone"
            amount={entry.chantierAmounts.zoneBonus > 0 ? `${formatEur(entry.chantierAmounts.zoneBonus)}/jour` : "non configurée sur le chantier"}
            checked={applied.zoneBonusApplied}
            disabled={entry.chantierAmounts.zoneBonus === 0}
            onChange={() => toggle("zoneBonusApplied")}
          />
          <CheckboxRow
            label="Prime de masque"
            amount={entry.chantierAmounts.maskBonus > 0 ? `${formatEur(entry.chantierAmounts.maskBonus)}/jour` : "non configurée sur le chantier"}
            checked={applied.maskBonusApplied}
            disabled={entry.chantierAmounts.maskBonus === 0}
            onChange={() => toggle("maskBonusApplied")}
          />
          <CheckboxRow
            label="Prime de poste"
            amount={entry.chantierAmounts.postBonus > 0 ? `${formatEur(entry.chantierAmounts.postBonus)}/jour` : "non configurée sur le chantier"}
            checked={applied.postBonusApplied}
            disabled={entry.chantierAmounts.postBonus === 0}
            onChange={() => toggle("postBonusApplied")}
          />
        </div>
        <p className="mb-2 mt-4 text-xs font-medium text-text">
          Grands déplacements <span className="font-normal text-muted">(nombre de jours, pas un montant)</span>
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Barème 53</Label>
            <Input
              type="number"
              min={0}
              max={7}
              step={1}
              value={grandsDeplacements.gdDepl53Count}
              onChange={(e) =>
                setGrandsDeplacements({ ...grandsDeplacements, gdDepl53Count: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div>
            <Label className="text-xs">Barème 80</Label>
            <Input
              type="number"
              min={0}
              max={7}
              step={1}
              value={grandsDeplacements.gdDepl80Count}
              onChange={(e) =>
                setGrandsDeplacements({ ...grandsDeplacements, gdDepl80Count: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Commentaires travaux</Label>
        <Textarea value={comments ?? ""} onChange={(e) => setComments(e.target.value)} rows={2} />
      </div>

      <div className="rounded-md border border-border bg-bg-subtle p-3 text-xs text-muted">
        {canSeeRates ? (
          <p>
            Heures de nuit : {totalNuit} h × {formatEur(hourlyRate)} × {nightRatePercent}% = <strong className="text-text">{formatEur(nightBonus)}</strong>
          </p>
        ) : (
          <p>
            Heures de nuit : {totalNuit} h, majoration {nightRatePercent}% (montant calculé à la paie)
          </p>
        )}
        <p>
          Indemnités ({daysWorked} jour{daysWorked > 1 ? "s" : ""} travaillé{daysWorked > 1 ? "s" : ""}) :{" "}
          <strong className="text-text">{formatEur(indemnitiesTotal)}</strong>
        </p>
        <p>
          Primes : <strong className="text-text">{formatEur(primesTotal)}</strong>
          {!canSeeRates && applied.managementBonusApplied && " (hors prime management, calculée à la paie)"}
        </p>
        {unites.length > 0 && <p>Unités : {unites.join(" · ")}</p>}
        <p className="mt-1 border-t border-border pt-1 text-sm text-text">
          Total frais de la semaine : <strong>{formatEur(nightBonus + indemnitiesTotal + primesTotal)}</strong>
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

function CheckboxRow({
  label,
  amount,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  amount: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs ${disabled ? "opacity-50" : "cursor-pointer hover:bg-bg-subtle"}`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="flex-1 text-text">{label}</span>
      <span className="text-muted">{amount}</span>
    </label>
  );
}

/** Case à cocher + nombre de fois où l'indemnité est donnée (repas). */
function CountCheckboxRow({
  label,
  amount,
  checked,
  disabled,
  onChange,
  count,
  max,
  onCountChange,
}: {
  label: string;
  amount: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  count: number;
  max: number;
  onCountChange: (n: number) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs ${disabled ? "opacity-50" : "hover:bg-bg-subtle"}`}
    >
      <label className={`flex flex-1 items-center gap-2 ${disabled ? "" : "cursor-pointer"}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
        <span className="flex-1 text-text">{label}</span>
        <span className="text-muted">{amount}</span>
      </label>
      {checked && (
        <div className="w-14 shrink-0">
          <Input
            type="number"
            min={0}
            max={max}
            step={1}
            value={count}
            aria-label={`Nombre de ${label.toLowerCase()}`}
            title={`Nombre de ${label.toLowerCase()} dans la semaine (au plus ${max})`}
            onChange={(e) => onCountChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="h-7 text-center"
          />
        </div>
      )}
    </div>
  );
}

/** Case à cocher + montant en euros saisi au même endroit (logement). */
function AmountCheckboxRow({
  label,
  hint,
  checked,
  onChange,
  amount,
  onAmountChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
  amount: number;
  onAmountChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-bg-subtle">
      <label className="flex flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="flex-1 text-text">{label}</span>
        <span className="text-muted">{hint}</span>
      </label>
      {checked && (
        <div className="w-20 shrink-0">
          <Input
            type="number"
            min={0}
            step={0.5}
            value={amount}
            aria-label={`${label} (€)`}
            title={`${label} de la semaine, en euros`}
            onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
            className="h-7 text-center"
          />
        </div>
      )}
      {checked && <span className="text-muted">€</span>}
    </div>
  );
}
