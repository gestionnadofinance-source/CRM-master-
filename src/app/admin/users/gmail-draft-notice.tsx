import { ExternalLink } from "lucide-react";
import type { DraftResult } from "@/server/google/gmail";

/**
 * Issue de la préparation d'un brouillon Gmail. Un brouillon n'est pas un
 * envoi : le libellé le dit, et le bouton ouvre Gmail où l'administrateur
 * relit et envoie lui-même.
 */
export function GmailDraftNotice({ draft, what }: { draft: DraftResult; what: string }) {
  if (draft.ok) {
    return (
      <div className="rounded-md border border-border bg-bg-subtle p-4 text-sm text-text">
        <p className="font-medium">{what} préparé dans votre Gmail — pas encore envoyé.</p>
        <p className="mt-1 text-muted">
          Il contient le lien de connexion, l&apos;identifiant et le mot de passe provisoire. Relisez-le puis cliquez sur
          « Envoyer » dans Gmail.
        </p>
        <a
          href={draft.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ouvrir le brouillon dans Gmail
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-400">
      <p className="font-medium">Le brouillon n&apos;a pas pu être préparé dans Gmail.</p>
      <p className="mt-1">{draft.error}</p>
      <p className="mt-1">Le mot de passe provisoire reste valable : transmettez-le vous-même.</p>
    </div>
  );
}
