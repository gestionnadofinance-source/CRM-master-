"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeApiKey } from "@/server/admin/api-keys";
import { Button } from "@/components/ui/button";

export function RevokeApiKeyButton({ keyId, keyName }: { keyId: string; keyName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onRevoke() {
    if (!window.confirm(`Révoquer la clé « ${keyName} » ? Toute intégration l'utilisant perdra l'accès immédiatement.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await revokeApiKey(keyId);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="danger" disabled={pending} onClick={onRevoke}>
        {pending ? "Révocation..." : "Révoquer"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-muted">{error}</p>}
    </div>
  );
}
