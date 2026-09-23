"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldAlert } from "lucide-react";
import { exportUserPersonalData, anonymizeUser } from "@/server/admin/rgpd";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";

/**
 * Outillage RGPD pour ce compte (voir README § "Données personnelles
 * (RGPD)") : export JSON (article 15) toujours disponible, anonymisation
 * (article 17) réservée à un compte déjà désactivé — remplace la
 * procédure manuelle documentée par ces deux actions en un clic.
 */
export function RgpdTools({
  userId,
  email,
  status,
  isSelf,
}: {
  userId: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  isSelf: boolean;
}) {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportPending, startExportTransition] = useTransition();

  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [anonymizeError, setAnonymizeError] = useState<string | null>(null);
  const [anonymizePending, startAnonymizeTransition] = useTransition();
  const router = useRouter();

  const canConfirmAnonymize = confirmText.trim().toLowerCase() === email.trim().toLowerCase();

  function handleExport() {
    setExportError(null);
    startExportTransition(async () => {
      const res = await exportUserPersonalData(userId);
      if (!res.ok || !res.data) {
        setExportError(res.error ?? "Erreur lors de l'export.");
        return;
      }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `donnees-personnelles-${email.replace(/[^a-zA-Z0-9.@-]/g, "_")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  function handleAnonymize() {
    if (!canConfirmAnonymize) return;
    setAnonymizeError(null);
    startAnonymizeTransition(async () => {
      const res = await anonymizeUser(userId, confirmText);
      if (!res.ok) {
        setAnonymizeError(res.error ?? "Erreur lors de l'anonymisation.");
        return;
      }
      setAnonymizeOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Données personnelles (RGPD)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Export JSON de toutes les données personnelles de ce compte (comptes CRM, sessions, messages envoyés,
              journal d&apos;activité, fiches de pointage) — pour répondre à une demande d&apos;accès ou de
              portabilité.
            </p>
            <Button variant="outline" size="sm" disabled={exportPending} onClick={handleExport}>
              <Download className="h-4 w-4" />
              {exportPending ? "Export..." : "Exporter les données personnelles"}
            </Button>
            {exportError && <p className="text-sm text-red-500">{exportError}</p>}
          </div>
        </CardContent>
      </Card>

      {!isSelf && (
        <Card className="border-red-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" />
              Anonymisation (droit à l&apos;effacement)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">
              Remplace le nom et l&apos;email de ce compte par des valeurs anonymes, de façon irréversible. Le
              travail associé (chantiers, pointages, documents...) est conservé pour l&apos;intégrité des données,
              mais n&apos;est plus rattaché à une personne identifiable.
            </p>
            {status !== "DISABLED" ? (
              <p className="text-sm text-amber-800 dark:text-amber-400">
                Désactivez d&apos;abord ce compte (bouton « Compte » ci-dessus) avant de pouvoir l&apos;anonymiser.
              </p>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setAnonymizeOpen(true)}>
                Anonymiser ce compte
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Modal open={anonymizeOpen} onClose={() => setAnonymizeOpen(false)} title="Confirmer l'anonymisation" width="sm">
        <div className="space-y-4">
          <p className="text-sm text-text">
            Cette action est irréversible. Pour confirmer, saisissez l&apos;adresse email exacte du compte :{" "}
            <strong>{email}</strong>
          </p>
          <div>
            <Label htmlFor="confirmAnonymizeEmail">Adresse email</Label>
            <Input
              id="confirmAnonymizeEmail"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
              autoComplete="off"
            />
          </div>
          {anonymizeError && <p className="text-sm text-red-500">{anonymizeError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAnonymizeOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" disabled={!canConfirmAnonymize || anonymizePending} onClick={handleAnonymize}>
              {anonymizePending ? "Anonymisation..." : "Confirmer l'anonymisation"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
