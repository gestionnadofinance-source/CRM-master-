"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addDays, format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarCheck, CalendarDays, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import {
  listPublicCommercials,
  getPublicSlotsForDate,
  getPublicFirstAvailable,
  submitPublicBooking,
  type PublicFirstAvailableResult,
} from "@/server/public-booking/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type Step = "landing" | "choose-commercial" | "choose-date" | "first-available" | "form" | "confirmed";

interface Commercial {
  id: string;
  displayName: string;
}

interface SelectedSlot {
  startAt: string;
  endAt: string;
  commercialId: string;
  commercialName: string;
}

export function BookingFlow({
  publicSlug,
  crmName,
  introMessage,
  slotDurationMinutes,
  minNoticeHours,
  maxAdvanceDays,
}: {
  publicSlug: string;
  crmName: string;
  introMessage: string | null;
  slotDurationMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
}) {
  const [step, setStep] = useState<Step>("landing");
  const [commercials, setCommercials] = useState<Commercial[]>([]);
  const [selectedCommercial, setSelectedCommercial] = useState<Commercial | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [daySlots, setDaySlots] = useState<string[]>([]);
  const [firstAvailable, setFirstAvailable] = useState<PublicFirstAvailableResult | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const minDate = format(addDays(new Date(), Math.ceil(minNoticeHours / 24)), "yyyy-MM-dd");
  const maxDate = format(addDays(new Date(), maxAdvanceDays), "yyyy-MM-dd");

  function goChooseCommercial() {
    setError(null);
    startTransition(async () => {
      const list = await listPublicCommercials(publicSlug);
      setCommercials(list);
      setStep("choose-commercial");
    });
  }

  function pickCommercial(c: Commercial) {
    setSelectedCommercial(c);
    setSelectedDate("");
    setDaySlots([]);
    setStep("choose-date");
  }

  function pickDate(dateStr: string) {
    setSelectedDate(dateStr);
    if (!selectedCommercial) return;
    startTransition(async () => {
      const slots = await getPublicSlotsForDate(publicSlug, selectedCommercial.id, dateStr);
      setDaySlots(slots);
    });
  }

  function goFirstAvailable() {
    setError(null);
    startTransition(async () => {
      const best = await getPublicFirstAvailable(publicSlug);
      setFirstAvailable(best);
      setStep("first-available");
    });
  }

  function skipToNextFirstAvailable() {
    if (!firstAvailable) return;
    startTransition(async () => {
      const next = await getPublicFirstAvailable(publicSlug, firstAvailable.startAt);
      setFirstAvailable(next);
    });
  }

  function chooseSlotAndContinue(slot: SelectedSlot) {
    setSelectedSlot(slot);
    setError(null);
    setStep("form");
  }

  function submit() {
    if (!formRef.current || !selectedSlot) return;
    const fd = new FormData(formRef.current);
    fd.set("commercialId", selectedSlot.commercialId);
    fd.set("startAt", selectedSlot.startAt);
    fd.set("endAt", selectedSlot.endAt);
    setError(null);
    startTransition(async () => {
      const res = await submitPublicBooking(publicSlug, fd);
      if (!res.ok) {
        setError(res.error ?? "Une erreur est survenue.");
        if (res.slotTaken) {
          // Le créneau vient d'être pris : on invite à en choisir un autre.
          setSelectedSlot(null);
          setStep(selectedCommercial ? "choose-date" : "landing");
        }
        return;
      }
      setConfirmedAt(selectedSlot.startAt);
      setStep("confirmed");
    });
  }

  const displaySlots = useMemo(
    () => daySlots.map((s) => ({ iso: s, label: format(new Date(s), "HH:mm") })),
    [daySlots]
  );

  return (
    <div className="space-y-6">
      <Card className="p-6 text-center">
        <h1 className="text-xl font-semibold text-text">{crmName}</h1>
        {introMessage && <p className="mt-2 text-sm text-muted">{introMessage}</p>}
        {step === "landing" && !introMessage && (
          <p className="mt-2 text-sm text-muted">Choisissez comment vous souhaitez prendre rendez-vous.</p>
        )}
      </Card>

      {step === "landing" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            onClick={goChooseCommercial}
            disabled={loading}
            className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center hover:border-brand hover:bg-brand/5"
          >
            <CalendarDays className="h-8 w-8 text-brand" />
            <span className="font-medium text-text">Choisir un commercial précis</span>
            <span className="text-xs text-muted">Sélectionnez la personne avec qui échanger</span>
          </button>
          <button
            onClick={goFirstAvailable}
            disabled={loading}
            className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center hover:border-brand hover:bg-brand/5"
          >
            <Sparkles className="h-8 w-8 text-brand" />
            <span className="font-medium text-text">Premier créneau disponible</span>
            <span className="text-xs text-muted">Nous trouvons le rendez-vous le plus rapide</span>
          </button>
        </div>
      )}

      {loading && <p className="flex items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Chargement...</p>}

      {step === "choose-commercial" && !loading && (
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-text">Avec qui souhaitez-vous prendre rendez-vous ?</p>
          {commercials.length === 0 ? (
            <p className="text-sm text-muted">Aucun commercial n&apos;est disponible pour le moment.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {commercials.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickCommercial(c)}
                  className="rounded-md border border-border px-4 py-3 text-left text-sm text-text hover:border-brand hover:bg-brand/5"
                >
                  {c.displayName}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => setStep("landing")}>
            Retour
          </Button>
        </Card>
      )}

      {step === "choose-date" && selectedCommercial && (
        <Card className="p-5 space-y-4">
          <p className="text-sm font-medium text-text">Rendez-vous avec {selectedCommercial.displayName}</p>
          <div>
            <Label htmlFor="bookingDate">Choisissez une date</Label>
            <Input
              id="bookingDate"
              type="date"
              min={minDate}
              max={maxDate}
              value={selectedDate}
              onChange={(e) => pickDate(e.target.value)}
            />
          </div>
          {selectedDate && !loading && (
            <div>
              {displaySlots.length === 0 ? (
                <p className="text-sm text-muted">Aucun créneau disponible ce jour-là. Essayez une autre date.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {displaySlots.map((s) => (
                    <button
                      key={s.iso}
                      onClick={() =>
                        chooseSlotAndContinue({
                          startAt: s.iso,
                          endAt: new Date(new Date(s.iso).getTime() + slotDurationMinutes * 60_000).toISOString(),
                          commercialId: selectedCommercial.id,
                          commercialName: selectedCommercial.displayName,
                        })
                      }
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:border-brand hover:bg-brand/10"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setStep("choose-commercial")}>
            Retour
          </Button>
        </Card>
      )}

      {step === "first-available" && !loading && (
        <Card className="p-5 space-y-4">
          {firstAvailable ? (
            <>
              <div className="flex items-center gap-3 rounded-md border border-brand/40 bg-brand/5 p-4">
                <CalendarCheck className="h-8 w-8 text-brand" />
                <div>
                  <p className="text-sm text-muted">Créneau proposé</p>
                  <p className="text-base font-semibold text-text">
                    {format(new Date(firstAvailable.startAt), "EEEE d MMMM yyyy à HH:mm", { locale: fr })}
                  </p>
                  <p className="text-sm text-muted">avec {firstAvailable.commercialName}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    chooseSlotAndContinue({
                      startAt: firstAvailable.startAt,
                      endAt: firstAvailable.endAt,
                      commercialId: firstAvailable.commercialId,
                      commercialName: firstAvailable.commercialName,
                    })
                  }
                >
                  Réserver ce créneau
                </Button>
                <Button variant="outline" onClick={skipToNextFirstAvailable}>
                  Voir un autre créneau
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Aucun créneau disponible pour le moment. Merci de réessayer plus tard.</p>
          )}
          <Button variant="ghost" size="sm" onClick={() => setStep("landing")}>
            Retour
          </Button>
        </Card>
      )}

      {step === "form" && selectedSlot && (
        <Card className="p-5">
          <div className="mb-4 rounded-md border border-border bg-bg-subtle p-3 text-sm">
            <p className="font-medium text-text">
              {format(new Date(selectedSlot.startAt), "EEEE d MMMM yyyy à HH:mm", { locale: fr })}
            </p>
            <p className="text-muted">avec {selectedSlot.commercialName}</p>
          </div>
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="firstName">Prénom *</Label>
                <Input id="firstName" name="firstName" required maxLength={100} />
              </div>
              <div>
                <Label htmlFor="lastName">Nom *</Label>
                <Input id="lastName" name="lastName" required maxLength={100} />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input id="email" name="email" type="email" required maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="phone">Téléphone</Label>
                <Input id="phone" name="phone" type="tel" maxLength={30} />
              </div>
              <div>
                <Label htmlFor="company">Entreprise</Label>
                <Input id="company" name="company" maxLength={200} />
              </div>
            </div>
            <div>
              <Label htmlFor="message">Message</Label>
              <Textarea id="message" name="message" rows={3} maxLength={2000} placeholder="Précisez l'objet de votre demande (optionnel)" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep("landing")}>
                Annuler
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Envoi..." : "Confirmer la réservation"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === "confirmed" && confirmedAt && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <h2 className="text-lg font-semibold text-text">Rendez-vous confirmé</h2>
          <p className="text-sm text-muted">
            Votre rendez-vous du {format(new Date(confirmedAt), "EEEE d MMMM yyyy à HH:mm", { locale: fr })} a bien été enregistré.
          </p>
          <p className="text-xs text-muted">Vous allez recevoir une confirmation. À bientôt !</p>
        </Card>
      )}
    </div>
  );
}
