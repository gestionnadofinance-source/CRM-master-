"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { updateBookingSettings } from "@/server/settings/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface BookingSettingsData {
  isEnabled: boolean;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  balancedDistribution: boolean;
  introMessage: string;
  publicUrl: string;
}

export function BookingSection({ crmId, crmSlug, initial }: { crmId: string; crmSlug: string; initial: BookingSettingsData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateBookingSettings(crmId, crmSlug, fd);
      if (!res.ok) setError(res.error ?? "Une erreur est survenue.");
      else setSuccess(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prise de rendez-vous en ligne</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Lien public de réservation</Label>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2">
            <code className="truncate text-sm text-text">{initial.publicUrl}</code>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-brand"
              onClick={() => {
                navigator.clipboard.writeText(initial.publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" name="isEnabled" defaultChecked={initial.isEnabled} className="h-4 w-4" />
            Réservation en ligne activée
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="slotDurationMinutes">Durée d&apos;un créneau (min)</Label>
              <Input
                id="slotDurationMinutes"
                name="slotDurationMinutes"
                type="number"
                defaultValue={initial.slotDurationMinutes}
              />
            </div>
            <div>
              <Label htmlFor="bufferMinutes">Battement entre créneaux (min)</Label>
              <Input id="bufferMinutes" name="bufferMinutes" type="number" defaultValue={initial.bufferMinutes} />
            </div>
            <div>
              <Label htmlFor="minNoticeHours">Délai minimum (heures)</Label>
              <Input id="minNoticeHours" name="minNoticeHours" type="number" defaultValue={initial.minNoticeHours} />
            </div>
            <div>
              <Label htmlFor="maxAdvanceDays">Réservable jusqu&apos;à (jours)</Label>
              <Input id="maxAdvanceDays" name="maxAdvanceDays" type="number" defaultValue={initial.maxAdvanceDays} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" name="balancedDistribution" defaultChecked={initial.balancedDistribution} className="h-4 w-4" />
            Répartition équilibrée entre commerciaux disponibles
          </label>
          <div>
            <Label htmlFor="introMessage">Message d&apos;introduction</Label>
            <Textarea id="introMessage" name="introMessage" rows={3} defaultValue={initial.introMessage} />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Enregistré.</p>}

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
