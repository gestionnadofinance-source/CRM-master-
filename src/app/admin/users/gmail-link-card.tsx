"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { unlinkGmailAccount } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Statuts de retour de la liaison (?gmail=...), traduits en phrase. */
const STATUTS: Record<string, { ok: boolean; texte: string }> = {
  ok: { ok: true, texte: "Compte Gmail relié. Les mails de bienvenue seront préparés en brouillon dans cette boîte." },
  refus: { ok: false, texte: "Liaison annulée : l'accès n'a pas été accordé dans Google." },
  etat_invalide: { ok: false, texte: "Liaison refusée par sécurité (demande expirée ou d'origine inconnue). Recommencez." },
  sans_jeton: {
    ok: false,
    texte:
      "Google n'a pas fourni d'accès durable : ce compte était déjà relié auparavant. Retirez « CRM Master » sur myaccount.google.com/permissions, puis recommencez.",
  },
  non_configure: { ok: false, texte: "La connexion Google n'est pas encore configurée sur le serveur." },
  erreur: { ok: false, texte: "La liaison a échoué côté Google. Réessayez dans un instant." },
};

export function GmailLinkCard({
  configured,
  account,
  statut,
}: {
  configured: boolean;
  account: { email: string; lastError: string | null } | null;
  statut: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const retour = statut ? STATUTS[statut] : undefined;

  function unlink() {
    if (!confirm("Délier ce compte Gmail ? Les prochains mails de bienvenue ne seront plus préparés en brouillon.")) return;
    setError(null);
    startTransition(async () => {
      const res = await unlinkGmailAccount();
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.replace("/admin/users");
    });
  }

  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <div>
            <p className="text-sm font-medium text-text">Mail de bienvenue des nouveaux utilisateurs</p>
            {account ? (
              <p className="text-sm text-muted">
                Compte relié : <span className="font-medium text-text">{account.email}</span> — à chaque création, un
                brouillon (lien de connexion, identifiant, mot de passe provisoire) y est préparé. Vous le relisez et
                l&apos;envoyez vous-même : rien n&apos;est envoyé automatiquement.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Reliez votre compte Gmail pour qu&apos;un brouillon de bienvenue soit préparé à chaque nouvel
                utilisateur. L&apos;application ne peut que préparer des brouillons : elle ne lit pas votre boîte et
                n&apos;envoie rien.
              </p>
            )}
          </div>
        </div>
        {account ? (
          <Button variant="outline" size="sm" className="shrink-0 whitespace-nowrap" disabled={pending} onClick={unlink}>
            Délier ce compte
          </Button>
        ) : configured ? (
          // Lien et non bouton d'action : le départ vers Google est une navigation.
          <a
            href="/api/google/connexion"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Relier mon compte Gmail
          </a>
        ) : (
          <p className="shrink-0 text-xs text-muted">Connexion Google non configurée sur le serveur.</p>
        )}
      </div>
      {account?.lastError && (
        <p className="text-sm text-amber-800 dark:text-amber-400">Dernier échec : {account.lastError}</p>
      )}
      {retour && (
        <p className={retour.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-amber-800 dark:text-amber-400"}>
          {retour.texte}
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Card>
  );
}
