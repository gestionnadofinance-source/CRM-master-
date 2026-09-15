"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Download, FileText, Activity as ActivityIcon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { DocumentList } from "@/components/documents/document-list";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { formatCurrency, formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import { saveQuote, setQuoteStatus, deleteQuote, generateAndStoreQuotePdf } from "@/server/quotes/actions";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_BADGE_VARIANT, QUOTE_STATUS_TRANSITIONS } from "@/server/quotes/status";
import { SendQuoteButton } from "./send-quote-button";
import { QuoteVersions, type QuoteEditorVersion } from "./quote-versions";
import type { QuoteStatus } from "@prisma/client";

export interface QuoteEditorClientOption {
  id: string;
  company: string;
  siret: string | null;
  address: string | null;
  email: string | null;
}

export type QuoteEditorProspectOption = QuoteEditorClientOption;

export interface QuoteEditorVatRate {
  id: string;
  label: string;
  rate: number;
}

export interface QuoteEditorItem {
  id?: string;
  designation: string;
  quantity: number;
  unitPriceHt: number;
  vatRateId: string;
}

export interface QuoteEditorActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  userName: string;
}

export interface QuoteEditorQuote {
  id: string;
  number: string;
  clientId: string | null;
  prospectId: string | null;
  object: string;
  issueDate: string;
  validUntil: string;
  status: QuoteStatus;
  conditions: string | null;
  mentions: string | null;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  currentVersion: number;
  createdByName: string;
  sentAt: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  items: QuoteEditorItem[];
  versions: QuoteEditorVersion[];
}

type LocalItem = QuoteEditorItem & { key: string };

function makeKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysInputValue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function QuoteEditor({
  crmId,
  crmSlug,
  clients,
  prospects,
  vatRates,
  quote,
  activity,
  prefillClientId,
  prefillProspectId,
  defaultConditions,
  defaultMentions,
  canManage,
  canDelete,
}: {
  crmId: string;
  crmSlug: string;
  clients: QuoteEditorClientOption[];
  prospects: QuoteEditorProspectOption[];
  vatRates: QuoteEditorVatRate[];
  quote: QuoteEditorQuote | null;
  activity: QuoteEditorActivityEntry[];
  prefillClientId: string;
  prefillProspectId: string;
  defaultConditions: string;
  defaultMentions: string;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const defaultVatRateId = vatRates[0]?.id ?? "";

  const [tab, setTab] = useState<"details" | "versions" | "documents" | "activity">("details");
  const initialEntityType: "client" | "prospect" = quote?.prospectId || (!quote?.clientId && prefillProspectId) ? "prospect" : "client";
  const [entityType, setEntityType] = useState<"client" | "prospect">(initialEntityType);
  const [clientId, setClientId] = useState(quote?.clientId ?? prefillClientId);
  const [prospectId, setProspectId] = useState(quote?.prospectId ?? prefillProspectId);
  const [object, setObject] = useState(quote?.object ?? "");
  const [issueDate, setIssueDate] = useState(quote?.issueDate ?? todayInputValue());
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? addDaysInputValue(30));
  const [conditions, setConditions] = useState(quote?.conditions ?? defaultConditions);
  const [mentions, setMentions] = useState(quote?.mentions ?? defaultMentions);
  const [items, setItems] = useState<LocalItem[]>(
    quote && quote.items.length > 0
      ? quote.items.map((i) => ({ ...i, key: makeKey() }))
      : [{ key: makeKey(), designation: "", quantity: 1, unitPriceHt: 0, vatRateId: defaultVatRateId }]
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const [pdfPending, startPdfTransition] = useTransition();
  const [documentsKey, setDocumentsKey] = useState(0);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);

  useRealtimeChannel(quote ? `private-crm-${crmId}` : null, {
    "quote.upserted": () => router.refresh(),
  });

  const vatRateById = useMemo(() => new Map(vatRates.map((v) => [v.id, v.rate])), [vatRates]);

  const totals = useMemo(() => {
    let totalHt = 0;
    let totalVat = 0;
    for (const item of items) {
      const rate = vatRateById.get(item.vatRateId) ?? 0;
      const lineHt = (Number(item.quantity) || 0) * (Number(item.unitPriceHt) || 0);
      totalHt += lineHt;
      totalVat += lineHt * (rate / 100);
    }
    return { totalHt, totalVat, totalTtc: totalHt + totalVat };
  }, [items, vatRateById]);

  const isDraft = !quote || quote.status === "DRAFT";
  const isReadOnlyLocked = !canManage;

  function updateItem(key: string, patch: Partial<LocalItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { key: makeKey(), designation: "", quantity: 1, unitPriceHt: 0, vatRateId: defaultVatRateId }]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  }

  function moveItem(key: string, direction: -1 | 1) {
    setItems((prev) => {
      const index = prev.findIndex((it) => it.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    if (entityType === "client" && !clientId) {
      setError("Sélectionnez un client.");
      return;
    }
    if (entityType === "prospect" && !prospectId) {
      setError("Sélectionnez un prospect.");
      return;
    }
    const payload = {
      clientId: entityType === "client" ? clientId : null,
      prospectId: entityType === "prospect" ? prospectId : null,
      object,
      issueDate,
      validUntil,
      conditions: conditions || null,
      mentions: mentions || null,
      items: items.map((it) => ({
        designation: it.designation,
        quantity: it.quantity,
        unitPriceHt: it.unitPriceHt,
        vatRateId: it.vatRateId,
      })),
    };
    startTransition(async () => {
      const res = await saveQuote(crmId, quote?.id ?? null, payload);
      if (!res.ok) {
        setError(res.error ?? "Erreur lors de l'enregistrement.");
        return;
      }
      if (!quote && res.quoteId) {
        router.push(`/c/${crmSlug}/quotes/${res.quoteId}`);
        return;
      }
      router.refresh();
    });
  }

  function handleStatus(status: QuoteStatus) {
    if (!quote) return;
    startStatusTransition(async () => {
      const res = await setQuoteStatus(crmId, quote.id, status);
      if (!res.ok) {
        setError(res.error ?? "Transition impossible.");
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!quote) return;
    if (!confirm(`Supprimer le devis ${quote.number} ? Cette action est irréversible.`)) return;
    startTransition(async () => {
      const res = await deleteQuote(crmId, quote.id);
      if (!res.ok) {
        setError(res.error ?? "Suppression impossible.");
        return;
      }
      router.push(`/c/${crmSlug}/quotes`);
    });
  }

  function handleGeneratePdf() {
    if (!quote) return;
    setPdfNotice(null);
    startPdfTransition(async () => {
      const res = await generateAndStoreQuotePdf(crmId, quote.id);
      if (!res.ok) {
        setError(res.error ?? "Génération du PDF impossible.");
        return;
      }
      setPdfNotice(`PDF généré : ${res.fileName}`);
      setDocumentsKey((k) => k + 1);
    });
  }

  const selectedParty = entityType === "client" ? clients.find((c) => c.id === clientId) : prospects.find((p) => p.id === prospectId);
  const nextStatuses = quote ? QUOTE_STATUS_TRANSITIONS[quote.status] : [];
  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "details", label: "Détails" },
    ...(quote
      ? [
          { key: "versions" as const, label: "Versions" },
          { key: "documents" as const, label: "Documents" },
          { key: "activity" as const, label: "Activité" },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/c/${crmSlug}/quotes`} className="text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-text">{quote ? quote.number : "Nouveau devis"}</h1>
              {quote && <Badge variant={QUOTE_STATUS_BADGE_VARIANT[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>}
              {quote && quote.currentVersion > 1 && <Badge variant="default">Version {quote.currentVersion}</Badge>}
            </div>
            <p className="text-sm text-muted">{quote ? `Créé par ${quote.createdByName}` : "Sélectionnez un client pour commencer"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {quote && (
            <>
              <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <FileText className="h-4 w-4" />
                  Aperçu PDF
                </Button>
              </a>
              <a href={`/api/quotes/${quote.id}/pdf?download=1`}>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                  Télécharger le PDF
                </Button>
              </a>
              {canManage && (
                <Button variant="outline" size="sm" onClick={handleGeneratePdf} disabled={pdfPending}>
                  {pdfPending ? "Génération..." : "Régénérer & archiver"}
                </Button>
              )}
              {canManage && <SendQuoteButton crmId={crmId} quoteId={quote.id} clientEmail={selectedParty?.email ?? null} onSent={() => router.refresh()} />}
              {canDelete && isDraft && (
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </Button>
              )}
            </>
          )}
          {canManage && (
            <Button size="sm" onClick={handleSave} disabled={pending}>
              {pending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {pdfNotice && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{pdfNotice}</p>}

      {quote && nextStatuses.length > 0 && canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Statut :</span>
          {nextStatuses.map((s) => (
            <Button key={s} variant="secondary" size="sm" onClick={() => handleStatus(s)} disabled={statusPending}>
              Marquer {QUOTE_STATUS_LABELS[s].toLowerCase()}
            </Button>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="clientId">Client ou prospect *</Label>
                <div className="flex gap-2">
                  <div className="w-32 shrink-0">
                    <Select
                      value={entityType}
                      onChange={(e) => setEntityType(e.target.value as "client" | "prospect")}
                      disabled={isReadOnlyLocked}
                    >
                      <option value="client">Client</option>
                      <option value="prospect">Prospect</option>
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1">
                    {entityType === "client" ? (
                      <Select id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={isReadOnlyLocked} required>
                        <option value="">Sélectionner un client...</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.company}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Select id="prospectId" value={prospectId} onChange={(e) => setProspectId(e.target.value)} disabled={isReadOnlyLocked} required>
                        <option value="">Sélectionner un prospect...</option>
                        {prospects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.company}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
                {entityType === "client" && clients.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Aucun client dans ce CRM.</p>
                )}
                {entityType === "prospect" && prospects.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Aucun prospect dans ce CRM.</p>
                )}
              </div>
              <div>
                <Label htmlFor="object">Objet *</Label>
                <Input id="object" value={object} onChange={(e) => setObject(e.target.value)} disabled={isReadOnlyLocked} required />
              </div>
              <div>
                <Label htmlFor="issueDate">Date d&apos;émission</Label>
                <Input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={isReadOnlyLocked} />
              </div>
              <div>
                <Label htmlFor="validUntil">Valable jusqu&apos;au</Label>
                <Input id="validUntil" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={isReadOnlyLocked} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Lignes du devis</CardTitle>
              {!isReadOnlyLocked && (
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4" />
                  Ajouter une ligne
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                {/* min-w sur la table : sans plancher, un tableau w-full dans un
                    conteneur overflow-x-auto se contente de tasser ses colonnes
                    à l'infini au lieu de jamais défiler — les champs
                    quantité/prix devenaient inutilisables sur mobile. */}
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-2 font-medium">Désignation</th>
                      <th className="w-20 py-2 pr-2 text-right font-medium">Qté</th>
                      <th className="w-28 py-2 pr-2 text-right font-medium">PU HT</th>
                      <th className="w-32 py-2 pr-2 font-medium">TVA</th>
                      <th className="w-28 py-2 pr-2 text-right font-medium">Total HT</th>
                      <th className="w-20 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, index) => {
                      const lineHt = (Number(item.quantity) || 0) * (Number(item.unitPriceHt) || 0);
                      return (
                        <tr key={item.key}>
                          <td className="py-1.5 pr-2">
                            <Input
                              value={item.designation}
                              onChange={(e) => updateItem(item.key, { designation: e.target.value })}
                              disabled={isReadOnlyLocked}
                              placeholder="Désignation"
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="text-right"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.key, { quantity: Number(e.target.value) })}
                              disabled={isReadOnlyLocked}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="text-right"
                              value={item.unitPriceHt}
                              onChange={(e) => updateItem(item.key, { unitPriceHt: Number(e.target.value) })}
                              disabled={isReadOnlyLocked}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Select value={item.vatRateId} onChange={(e) => updateItem(item.key, { vatRateId: e.target.value })} disabled={isReadOnlyLocked}>
                              {vatRates.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label} ({v.rate}%)
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-1.5 pr-2 text-right font-medium text-text">{formatCurrency(lineHt)}</td>
                          <td className="py-1.5">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveItem(item.key, -1)}
                                disabled={isReadOnlyLocked || index === 0}
                                className="text-muted hover:text-text disabled:opacity-30"
                                aria-label="Monter"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveItem(item.key, 1)}
                                disabled={isReadOnlyLocked || index === items.length - 1}
                                className="text-muted hover:text-text disabled:opacity-30"
                                aria-label="Descendre"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeItem(item.key)}
                                disabled={isReadOnlyLocked || items.length <= 1}
                                className="text-muted hover:text-red-500 disabled:opacity-30"
                                aria-label="Supprimer la ligne"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>Total HT</span>
                    <span>{formatCurrency(totals.totalHt)}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>Total TVA</span>
                    <span>{formatCurrency(totals.totalVat)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1 text-base font-semibold text-text">
                    <span>Total TTC</span>
                    <span>{formatCurrency(totals.totalTtc)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conditions & mentions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="conditions">Conditions</Label>
                <Textarea id="conditions" rows={5} value={conditions} onChange={(e) => setConditions(e.target.value)} disabled={isReadOnlyLocked} />
              </div>
              <div>
                <Label htmlFor="mentions">Mentions</Label>
                <Textarea id="mentions" rows={5} value={mentions} onChange={(e) => setMentions(e.target.value)} disabled={isReadOnlyLocked} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "versions" && quote && <QuoteVersions versions={quote.versions} currentVersion={quote.currentVersion} />}

      {tab === "documents" && quote && (
        <Card>
          <CardContent className="pt-4">
            <DocumentList key={documentsKey} crmId={crmId} entityType="QUOTE" entityId={quote.id} canDelete={canManage} />
          </CardContent>
        </Card>
      )}

      {tab === "activity" && quote && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4" />
              Historique
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 && <p className="text-sm text-muted">Aucune activité enregistrée.</p>}
            <ul className="space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="font-medium text-text">{a.userName}</span>{" "}
                  <span className="text-muted">
                    {translateActivityAction(a.action)} · {formatDate(a.createdAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
