import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { listApiKeys } from "@/server/admin/api-keys";
import { Card, Badge } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { CreateApiKeyButton } from "./create-api-key-button";
import { RevokeApiKeyButton } from "./revoke-api-key-button";

export default async function AdminApiKeysPage() {
  // Voir le commentaire équivalent dans admin/page.tsx : le layout admin
  // ne suffit pas seul à empêcher un non-admin d'atteindre cette page.
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const keys = await listApiKeys();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Clés API</h1>
          <p className="text-sm text-muted">
            Accès à toutes les données de tous les CRM, pour des intégrations externes (ex. Obsidian). Chaque clé est
            soit en lecture seule, soit en lecture et écriture — choisi une fois pour toutes à la création.
          </p>
        </div>
        <CreateApiKeyButton />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Nom</th>
                <th className="px-4 py-2.5 font-medium">Clé</th>
                <th className="px-4 py-2.5 font-medium">Permission</th>
                <th className="px-4 py-2.5 font-medium">Créée par</th>
                <th className="px-4 py-2.5 font-medium">Dernière utilisation</th>
                <th className="px-4 py-2.5 font-medium">Statut</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-bg-subtle">
                  <td className="px-4 py-3 font-medium text-text">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-muted">{k.keyPrefix}…</code>
                  </td>
                  <td className="px-4 py-3">
                    {k.permission === "READ_WRITE" ? (
                      <Badge variant="warning">Lecture et écriture</Badge>
                    ) : (
                      <Badge>Lecture seule</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {k.createdBy.firstName} {k.createdBy.lastName}
                  </td>
                  <td className="px-4 py-3 text-muted">{k.lastUsedAt ? formatDate(k.lastUsedAt, true) : "Jamais"}</td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="text-xs text-red-500">Révoquée le {formatDate(k.revokedAt)}</span>
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!k.revokedAt && <RevokeApiKeyButton keyId={k.id} keyName={k.name} />}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">
                    Aucune clé API pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
