"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { formatCurrency, formatDate } from "@/lib/utils";

export interface QuoteEditorVersion {
  id: string;
  versionNumber: number;
  note: string | null;
  createdAt: string;
  authorName: string;
  snapshot: unknown;
}

interface SnapshotItem {
  designation: string;
  quantity: number | string;
  unitPriceHt: number | string;
  vatRateId: string;
  order: number;
}

interface SnapshotShape {
  number?: string;
  object?: string;
  status?: string;
  issueDate?: string;
  validUntil?: string;
  conditions?: string | null;
  mentions?: string | null;
  totalHt?: number | string;
  totalVat?: number | string;
  totalTtc?: number | string;
  items?: SnapshotItem[];
}

/**
 * Historique en lecture seule des versions archivées d'un devis. Une version
 * est créée automatiquement lorsqu'on modifie un devis déjà envoyé (jamais
 * d'écrasement silencieux) — cette vue permet de consulter l'état figé de
 * chaque version, sans possibilité de restauration directe.
 */
export function QuoteVersions({ versions, currentVersion }: { versions: QuoteEditorVersion[]; currentVersion: number }) {
  const [viewing, setViewing] = useState<QuoteEditorVersion | null>(null);
  const snapshot = viewing?.snapshot as SnapshotShape | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique des versions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted">
          Version actuelle : {currentVersion}. Chaque modification d&apos;un devis déjà envoyé archive automatiquement son état
          précédent.
        </p>
        {versions.length === 0 ? (
          <p className="text-sm text-muted">Aucune version archivée — ce devis n&apos;a pas encore été modifié après son envoi.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm text-text">Version {v.versionNumber}</p>
                  <p className="text-xs text-muted">
                    {v.authorName} · {formatDate(v.createdAt, true)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setViewing(v)}>
                  Voir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Version ${viewing?.versionNumber ?? ""}`} width="lg">
        {snapshot && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-text">{snapshot.object}</p>
              <p className="text-xs text-muted">
                Statut à l&apos;époque : {snapshot.status} · Émis le {snapshot.issueDate ? formatDate(snapshot.issueDate) : "—"} · Valide
                jusqu&apos;au {snapshot.validUntil ? formatDate(snapshot.validUntil) : "—"}
              </p>
            </div>
            {snapshot.items && snapshot.items.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1">Désignation</th>
                    <th className="py-1 text-right">Qté</th>
                    <th className="py-1 text-right">PU HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {snapshot.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="py-1">{it.designation}</td>
                      <td className="py-1 text-right">{it.quantity}</td>
                      <td className="py-1 text-right">{formatCurrency(it.unitPriceHt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end">
              <div className="w-56 space-y-1">
                <div className="flex justify-between text-muted">
                  <span>Total HT</span>
                  <span>{formatCurrency(snapshot.totalHt)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Total TVA</span>
                  <span>{formatCurrency(snapshot.totalVat)}</span>
                </div>
                <div className="flex justify-between font-semibold text-text">
                  <span>Total TTC</span>
                  <span>{formatCurrency(snapshot.totalTtc)}</span>
                </div>
              </div>
            </div>
            {snapshot.conditions && (
              <div>
                <p className="text-xs uppercase text-muted">Conditions</p>
                <p className="text-text">{snapshot.conditions}</p>
              </div>
            )}
            {snapshot.mentions && (
              <div>
                <p className="text-xs uppercase text-muted">Mentions</p>
                <p className="text-text">{snapshot.mentions}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
