"use client";

import { useActionState } from "react";
import { changePassword } from "@/server/auth/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/auth/actions";

const initialState: ActionResult = { ok: false };

export function PasswordForm() {
  const [state, formAction, isPending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="currentPassword">Mot de passe actuel</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input id="password" name="password" type="password" required autoComplete="new-password" />
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirmation</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-500">Mot de passe mis à jour.</p>}
      <Button type="submit" disabled={isPending}>{isPending ? "Enregistrement..." : "Changer le mot de passe"}</Button>
    </form>
  );
}
