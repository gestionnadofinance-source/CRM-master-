"use client";

import { useRef, useState, useTransition } from "react";
import { createOpportunity, updateOpportunity } from "@/server/pipeline/actions";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Option {
  id: string;
  company: string;
}

/** Doit rester égal au `take` des requêtes clients/prospects de pipeline/page.tsx — sert uniquement à détecter une liste tronquée pour prévenir l'utilisateur. */
const CLIENT_PROSPECT_LIST_CAP = 500;

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

interface Stage {
  id: string;
  name: string;
}

export interface OpportunityFormInitial {
  id: string;
  title: string;
  amount: number | null;
  ownerId: string;
  clientId: string | null;
  prospectId: string | null;
  stageId: string;
  nextAction: string | null;
}

export function OpportunityForm({
  crmId,
  stages,
  clients,
  prospects,
  members,
  currentUserId,
  defaultStageId,
  opportunity,
  onSuccess,
}: {
  crmId: string;
  stages: Stage[];
  clients: Option[];
  prospects: Option[];
  members: Member[];
  currentUserId: string;
  defaultStageId?: string;
  opportunity?: OpportunityFormInitial;
  onSuccess?: (opportunityId: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<"client" | "prospect">(
    opportunity?.clientId ? "client" : "prospect"
  );

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const res = opportunity
            ? await updateOpportunity(crmId, opportunity.id, fd)
            : await createOpportunity(crmId, fd);
          if (!res.ok) {
            setError(res.error ?? "Une erreur est survenue.");
            return;
          }
          if (res.opportunityId) onSuccess?.(res.opportunityId);
        });
      }}
    >
      <div>
        <Label htmlFor="title">Titre *</Label>
        <Input id="title" name="title" required defaultValue={opportunity?.title} placeholder="Ex : nom de l'entreprise" />
      </div>

      <div>
        <Label>Lié à</Label>
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => setLinkType("client")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${linkType === "client" ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted"}`}
          >
            Client
          </button>
          <button
            type="button"
            onClick={() => setLinkType("prospect")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${linkType === "prospect" ? "bg-brand text-brand-fg" : "bg-bg-subtle text-muted"}`}
          >
            Prospect
          </button>
        </div>
        {linkType === "client" ? (
          <>
            <Select name="clientId" defaultValue={opportunity?.clientId ?? ""}>
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </Select>
            {clients.length >= CLIENT_PROSPECT_LIST_CAP && (
              <p className="mt-1 text-xs text-muted">
                {clients.length}+ clients — la liste peut être incomplète, cherchez le client concerné depuis la page Clients si vous ne le trouvez pas ici.
              </p>
            )}
          </>
        ) : (
          <>
            <Select name="prospectId" defaultValue={opportunity?.prospectId ?? ""}>
              <option value="">—</option>
              {prospects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.company}
                </option>
              ))}
            </Select>
            {prospects.length >= CLIENT_PROSPECT_LIST_CAP && (
              <p className="mt-1 text-xs text-muted">
                {prospects.length}+ prospects — la liste peut être incomplète, cherchez le prospect concerné depuis la page Prospects si vous ne le trouvez pas ici.
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amount">Montant potentiel (€)</Label>
          <Input id="amount" name="amount" type="number" min={0} step="0.01" defaultValue={opportunity?.amount ?? ""} />
        </div>
        <div>
          <Label htmlFor="ownerId">Commercial *</Label>
          <Select id="ownerId" name="ownerId" required defaultValue={opportunity?.ownerId ?? currentUserId}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="stageId">Étape *</Label>
          {opportunity ? (
            <>
              <input type="hidden" name="stageId" value={opportunity.stageId} />
              <Select id="stageId" disabled defaultValue={opportunity.stageId}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">Glissez-déposez la carte dans le pipeline pour changer d&apos;étape.</p>
            </>
          ) : (
            <Select id="stageId" name="stageId" required defaultValue={defaultStageId}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div>
          <Label htmlFor="nextAction">Prochaine action</Label>
          <Input id="nextAction" name="nextAction" defaultValue={opportunity?.nextAction ?? ""} />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement..." : opportunity ? "Enregistrer" : "Créer l'opportunité"}
        </Button>
      </div>
    </form>
  );
}
