"use client";

import { useActionState } from "react";
import { loginStep1, type ActionResult } from "@/server/auth/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: true };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginStep1, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="vous@entreprise.fr" />
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Connexion..." : "Se connecter"}
      </Button>
      <p className="text-center text-xs text-muted">
        Mot de passe oublié ? Contactez votre administrateur.
      </p>
    </form>
  );
}
