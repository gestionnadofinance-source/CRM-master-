"use client";

import { useState, useTransition } from "react";
import { updateCompanySettings } from "@/server/settings/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface CompanySettingsData {
  legalName: string;
  logoUrl: string;
  address: string;
  postalCode: string;
  city: string;
  siret: string;
  phone: string;
  email: string;
  website: string;
  legalMentions: string;
  ape: string;
  urssafOffice: string;
  legalRepresentative: string;
  missionOrderLegalMentions: string;
}

export function CompanySection({ crmId, crmSlug, initial }: { crmId: string; crmSlug: string; initial: CompanySettingsData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateCompanySettings(crmId, crmSlug, fd);
      if (!res.ok) setError(res.error ?? "Une erreur est survenue.");
      else setSuccess(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations entreprise</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="legalName">Raison sociale</Label>
              <Input id="legalName" name="legalName" defaultValue={initial.legalName} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="logoUrl">URL du logo</Label>
              <Input id="logoUrl" name="logoUrl" defaultValue={initial.logoUrl} placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <Label htmlFor="address">Adresse</Label>
              <Input id="address" name="address" defaultValue={initial.address} />
            </div>
            <div>
              <Label htmlFor="postalCode">Code postal</Label>
              <Input id="postalCode" name="postalCode" defaultValue={initial.postalCode} />
            </div>
            <div>
              <Label htmlFor="city">Ville</Label>
              <Input id="city" name="city" defaultValue={initial.city} />
            </div>
            <div>
              <Label htmlFor="siret">SIRET</Label>
              <Input id="siret" name="siret" defaultValue={initial.siret} />
            </div>
            <div>
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" name="phone" defaultValue={initial.phone} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={initial.email} />
            </div>
            <div>
              <Label htmlFor="website">Site web</Label>
              <Input id="website" name="website" defaultValue={initial.website} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="legalMentions">Mentions légales</Label>
              <Textarea id="legalMentions" name="legalMentions" rows={4} defaultValue={initial.legalMentions} />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-medium text-text">En-tête de l&apos;ordre de mission</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ape">Code APE</Label>
                <Input id="ape" name="ape" defaultValue={initial.ape} />
              </div>
              <div>
                <Label htmlFor="urssafOffice">URSSAF de rattachement</Label>
                <Input id="urssafOffice" name="urssafOffice" placeholder="URSSAF du Nord Pas de Calais" defaultValue={initial.urssafOffice} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="legalRepresentative">Représentant légal</Label>
                <Input id="legalRepresentative" name="legalRepresentative" defaultValue={initial.legalRepresentative} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="missionOrderLegalMentions">Mentions légales de l&apos;ordre de mission</Label>
                <Textarea
                  id="missionOrderLegalMentions"
                  name="missionOrderLegalMentions"
                  rows={3}
                  placeholder="Laisser vide pour utiliser le texte par défaut (véhicule personnel obligatoire, frais non pris en charge...)."
                  defaultValue={initial.missionOrderLegalMentions}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-700 dark:text-emerald-400">Enregistré.</p>}

          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
