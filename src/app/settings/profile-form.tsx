"use client";

import { useActionState } from "react";
import { updateOwnProfile } from "@/server/users/actions";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/auth/actions";
import type { User } from "@prisma/client";

const initialState: ActionResult = { ok: false };

export function ProfileForm({ user }: { user: User }) {
  const [state, formAction, isPending] = useActionState(updateOwnProfile, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="firstName">Prénom</Label>
          <Input id="firstName" name="firstName" defaultValue={user.firstName} required />
        </div>
        <div>
          <Label htmlFor="lastName">Nom</Label>
          <Input id="lastName" name="lastName" defaultValue={user.lastName} required />
        </div>
      </div>
      <div>
        <Label htmlFor="color">Couleur personnelle</Label>
        <input id="color" name="color" type="color" defaultValue={user.color} className="h-9 w-16 rounded border border-border bg-surface" />
      </div>
      <div>
        <Label htmlFor="signatureText">Signature (texte)</Label>
        <Textarea id="signatureText" name="signatureText" defaultValue={user.signatureText ?? ""} placeholder="Utilisée sur vos devis et documents." />
      </div>
      <div className="flex items-center gap-2">
        <input id="notifyByEmail" name="notifyByEmail" type="checkbox" defaultChecked={user.notifyByEmail} className="h-4 w-4 rounded border-border" />
        <Label htmlFor="notifyByEmail" className="mb-0">Recevoir les notifications par email</Label>
      </div>
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-500">Profil mis à jour.</p>}
      <Button type="submit" disabled={isPending}>{isPending ? "Enregistrement..." : "Enregistrer"}</Button>
    </form>
  );
}
