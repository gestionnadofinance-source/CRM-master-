"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { sendQuote } from "@/server/quotes/actions";

/**
 * Bouton "Envoyer le devis" : passe le devis en SENT (si besoin) et génère
 * le PDF côté serveur, puis ouvre une modale permettant d'ajuster le
 * sujet/corps de l'email avant de déclencher le téléchargement du PDF et
 * l'ouverture du client mail par défaut via un lien mailto.
 *
 * Limite assumée : un lien mailto ne peut jamais joindre un fichier — c'est
 * une contrainte du protocole/des navigateurs, pas un oubli. On télécharge
 * donc le PDF en parallèle pour que l'utilisateur puisse le joindre
 * manuellement, et on l'indique clairement dans l'interface.
 */
export function SendQuoteButton({
  crmId,
  quoteId,
  clientEmail,
  onSent,
}: {
  crmId: string;
  quoteId: string;
  clientEmail: string | null;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState(clientEmail ?? "");
  const [fileName, setFileName] = useState<string | null>(null);

  function prepare() {
    setError(null);
    startTransition(async () => {
      const res = await sendQuote(crmId, quoteId);
      if (!res.ok) {
        setError(res.error ?? "Erreur lors de la préparation de l'envoi.");
        return;
      }
      setSubject(res.subject);
      setBody(res.body);
      setToEmail(res.clientEmail ?? clientEmail ?? "");
      setFileName(res.fileName ?? null);
      setOpen(true);
      onSent?.();
    });
  }

  function confirmSend() {
    const link = document.createElement("a");
    link.href = `/api/quotes/${quoteId}/pdf?download=1`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    const mailto = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setOpen(false);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={prepare} disabled={pending}>
        <Send className="h-4 w-4" />
        {pending ? "Préparation..." : "Envoyer le devis"}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Envoyer le devis par email" width="lg">
        <div className="space-y-4">
          <div>
            <Label htmlFor="toEmail">Destinataire</Label>
            <Input id="toEmail" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="client@exemple.fr" />
            {!clientEmail && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Aucun email connu pour ce client — renseignez-en un avant d&apos;envoyer.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="subject">Sujet</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            Le PDF{fileName ? ` (${fileName})` : ""} a été généré et va être téléchargé sur votre poste — un lien mailto ne permet pas
            de joindre un fichier automatiquement. Veuillez le joindre manuellement à l&apos;email qui va s&apos;ouvrir dans votre
            client de messagerie.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" size="sm" onClick={confirmSend} disabled={!toEmail}>
              Télécharger le PDF et ouvrir l&apos;email
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
