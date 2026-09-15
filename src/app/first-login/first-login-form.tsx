"use client";

import { useActionState } from "react";
import { setFirstPassword, type ActionResult } from "@/server/auth/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: true };

export function FirstLoginForm() {
  const [state, formAction, isPending] = useActionState(setFirstPassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" required autoComplete="new-password" />
        <p className="mt-1 text-xs text-muted">Au moins 10 caractères, une majuscule, une minuscule, un chiffre.</p>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" />
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Enregistrement..." : "Définir mon mot de passe"}
      </Button>
    </form>
  );
}
