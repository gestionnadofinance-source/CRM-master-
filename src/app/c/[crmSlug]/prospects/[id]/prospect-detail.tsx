"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, Mail, CalendarPlus, CheckSquare, FileText, Pencil, Trash2, Plus, ArrowRightLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { DocumentList } from "@/components/documents/document-list";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import { ProspectForm, type ProspectFormInitial } from "../prospect-form";
import {
  addProspectContact,
  deleteProspectContact,
  deleteProspect,
  convertProspectToClient,
} from "@/server/prospects/actions";
import type { ProspectStatus } from "@prisma/client";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

interface ScoreLine {
  label: string;
  points: number;
}

interface ProspectData {
  id: string;
  company: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  siret: string | null;
  sector: string | null;
  activity: string | null;
  size: string | null;
  sourceId: string | null;
  sourceName: string | null;
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string; color: string };
  status: ProspectStatus;
  score: number;
  scoreBreakdown: ScoreLine[];
  potentialAmount: number | null;
  notes: string | null;
  lastContactAt: string | null;
  nextContactAt: string | null;
  lostReason: string | null;
  createdAt: string;
  tags: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; role: string | null; phone: string | null; email: string | null }[];
  convertedClientId: string | null;
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  HOT: "Chaud",
  COLD: "Froid",
  TO_FOLLOW_UP: "À relancer",
  CONVERTED: "Converti",
  LOST: "Perdu",
};

const STATUS_BADGE: Record<ProspectStatus, "default" | "success" | "warning" | "danger" | "brand"> = {
  HOT: "danger",
  COLD: "brand",
  TO_FOLLOW_UP: "warning",
  CONVERTED: "success",
  LOST: "default",
};

export function ProspectDetail({
  crmSlug,
  crmId,
  prospect,
  activity,
  appointments,
  tasks,
  opportunities,
  sources,
  tags,
  members,
  currentUserId,
  canEdit,
  canDelete,
  canConvert,
}: {
  crmSlug: string;
  crmId: string;
  prospect: ProspectData;
  activity: { id: string; action: string; createdAt: string; userName: string }[];
  appointments: { id: string; title: string; startAt: string; status: string }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null }[];
  opportunities: { id: string; title: string; amount: number | null; stageName: string; stageColor: string }[];
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  members: Member[];
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
  canConvert: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [convertError, setConvertError] = useState<string | null>(null);

  useRealtimeChannel(`private-crm-${crmId}`, {
    "prospect.upserted": () => router.refresh(),
  });

  const formInitial: ProspectFormInitial = {
    id: prospect.id,
    company: prospect.company,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    phone: prospect.phone,
    email: prospect.email,
    address: prospect.address,
    siret: prospect.siret,
    sector: prospect.sector,
    activity: prospect.activity,
    size: prospect.size,
    sourceId: prospect.sourceId,
    ownerId: prospect.ownerId,
    status: prospect.status,
    potentialAmount: prospect.potentialAmount,
    notes: prospect.notes,
    tagIds: prospect.tags.map((t) => t.id),
    lastContactAt: prospect.lastContactAt,
    nextContactAt: prospect.nextContactAt,
  };

  const alreadyConverted = prospect.status === "CONVERTED" || !!prospect.convertedClientId;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text">{prospect.company}</h1>
            <Badge variant={STATUS_BADGE[prospect.status]}>{STATUS_LABELS[prospect.status]}</Badge>
          </div>
          <p className="text-sm text-muted">
            Commercial : {prospect.owner.firstName} {prospect.owner.lastName} · Ajouté le {formatDate(prospect.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {prospect.phone && (
            <a href={`tel:${prospect.phone}`}>
              <Button variant="outline" size="sm">
                <Phone className="h-4 w-4" /> Appeler
              </Button>
            </a>
          )}
          {prospect.email && (
            <a href={`mailto:${prospect.email}`}>
              <Button variant="outline" size="sm">
                <Mail className="h-4 w-4" /> Email
              </Button>
            </a>
          )}
          <Link href={`/c/${crmSlug}/agenda?newForProspect=${prospect.id}`}>
            <Button variant="outline" size="sm">
              <CalendarPlus className="h-4 w-4" /> Nouveau RDV
            </Button>
          </Link>
          <Link href={`/c/${crmSlug}/tasks?newForProspect=${prospect.id}`}>
            <Button variant="outline" size="sm">
              <CheckSquare className="h-4 w-4" /> Nouvelle tâche
            </Button>
          </Link>
          <Link href={`/c/${crmSlug}/quotes?newForProspect=${prospect.id}`}>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" /> Nouveau devis
            </Button>
          </Link>
          {canEdit && (
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Modifier
            </Button>
          )}
          {canConvert && !alreadyConverted && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Convertir ${prospect.company} en client ?`)) return;
                setConvertError(null);
                startTransition(async () => {
                  const res = await convertProspectToClient(crmId, prospect.id);
                  if (!res.ok) {
                    setConvertError(res.error ?? "Échec de la conversion.");
                    return;
                  }
                  router.push(`/c/${crmSlug}/clients/${res.clientId}`);
                });
              }}
            >
              <ArrowRightLeft className="h-4 w-4" /> Convertir en client
            </Button>
          )}
          {alreadyConverted && prospect.convertedClientId && (
            <Link href={`/c/${crmSlug}/clients/${prospect.convertedClientId}`}>
              <Button size="sm" variant="secondary">
                <ArrowRightLeft className="h-4 w-4" /> Voir la fiche client
              </Button>
            </Link>
          )}
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Supprimer définitivement ${prospect.company} ?`)) return;
                startTransition(async () => {
                  const res = await deleteProspect(crmId, prospect.id);
                  if (res.ok) router.push(`/c/${crmSlug}/prospects`);
                });
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
        </div>
      </div>

      {convertError && <p className="text-sm text-red-500">{convertError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="Contact" value={[prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || "—"} />
                <Field label="Téléphone" value={prospect.phone ?? "—"} />
                <Field label="Email" value={prospect.email ?? "—"} />
                <Field label="Adresse" value={prospect.address ?? "—"} />
                <Field label="Secteur" value={prospect.sector ?? "—"} />
                <Field label="Activité" value={prospect.activity ?? "—"} />
                <Field label="Taille" value={prospect.size ?? "—"} />
                <Field label="SIRET" value={prospect.siret ?? "—"} />
                <Field label="Source" value={prospect.sourceName ?? "—"} />
                <Field
                  label="Montant potentiel"
                  value={prospect.potentialAmount != null ? `${prospect.potentialAmount.toLocaleString("fr-FR")} €` : "—"}
                />
                <Field label="Dernier contact" value={prospect.lastContactAt ? formatDate(prospect.lastContactAt) : "—"} />
                <Field label="Prochaine relance" value={prospect.nextContactAt ? formatDate(prospect.nextContactAt) : "—"} />
              </dl>
              {prospect.status === "LOST" && prospect.lostReason && (
                <p className="mt-3 rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">
                  Motif de perte : {prospect.lostReason}
                </p>
              )}
              {prospect.notes && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-text">{prospect.notes}</p>
                </div>
              )}
              {prospect.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {prospect.tags.map((t) => (
                    <Badge key={t.id} variant="brand">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Contacts</CardTitle>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setContactFormOpen((o) => !o)}>
                  <Plus className="h-4 w-4" /> Ajouter
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {contactFormOpen && (
                <ContactForm
                  crmId={crmId}
                  prospectId={prospect.id}
                  onDone={() => {
                    setContactFormOpen(false);
                    router.refresh();
                  }}
                />
              )}
              {prospect.contacts.length === 0 && !contactFormOpen && (
                <p className="text-sm text-muted">Aucun contact additionnel.</p>
              )}
              <ul className="divide-y divide-border">
                {prospect.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-text">
                        {c.firstName} {c.lastName} {c.role && <span className="font-normal text-muted">· {c.role}</span>}
                      </p>
                      <p className="text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {canEdit && (
                      <button
                        className="text-muted hover:text-red-500"
                        onClick={() =>
                          startTransition(async () => {
                            await deleteProspectContact(crmId, prospect.id, c.id);
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {(appointments.length > 0 || tasks.length > 0) && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Rendez-vous</CardTitle>
                </CardHeader>
                <CardContent>
                  {appointments.length === 0 && <p className="text-sm text-muted">Aucun rendez-vous.</p>}
                  <ul className="space-y-2">
                    {appointments.map((a) => (
                      <li key={a.id} className="text-sm">
                        <p className="text-text">{a.title}</p>
                        <p className="text-xs text-muted">{formatDate(a.startAt, true)}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Tâches</CardTitle>
                </CardHeader>
                <CardContent>
                  {tasks.length === 0 && <p className="text-sm text-muted">Aucune tâche.</p>}
                  <ul className="space-y-2">
                    {tasks.map((t) => (
                      <li key={t.id} className="text-sm">
                        <p className="text-text">{t.title}</p>
                        <p className="text-xs text-muted">{t.dueAt ? formatDate(t.dueAt) : "Sans échéance"}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {opportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Opportunités liées</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {opportunities.map((o) => (
                    <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                      <Link href={`/c/${crmSlug}/pipeline`} className="text-text hover:text-brand">
                        {o.title}
                      </Link>
                      <div className="flex items-center gap-2">
                        <Badge style={{ backgroundColor: `${o.stageColor}25`, color: o.stageColor }}>{o.stageName}</Badge>
                        {o.amount != null && <span className="text-muted">{o.amount.toLocaleString("fr-FR")} €</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentList crmId={crmId} entityType="PROSPECT" entityId={prospect.id} canDelete={canDelete} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Score {prospect.score}/100</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, prospect.score)}%` }}
                />
              </div>
              {prospect.scoreBreakdown.length === 0 ? (
                <p className="text-sm text-muted">Aucun critère de score rempli pour l&apos;instant.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {prospect.scoreBreakdown.map((line, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span className="text-text">{line.label}</span>
                      <span className="font-medium text-brand">+{line.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historique</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 && <p className="text-sm text-muted">Aucune activité enregistrée.</p>}
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="text-text">{translateActivityAction(a.action)}</p>
                    <p className="text-xs text-muted">
                      {a.userName} · {formatDate(a.createdAt, true)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le prospect" width="lg">
        <ProspectForm
          crmId={crmId}
          crmSlug={crmSlug}
          sources={sources}
          tags={tags}
          members={members}
          currentUserId={currentUserId}
          prospect={formInitial}
          onSuccess={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="break-words text-text">{value}</dd>
    </div>
  );
}

function ContactForm({ crmId, prospectId, onDone }: { crmId: string; prospectId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const res = await addProspectContact(crmId, prospectId, fd);
          if (!res.ok) setError(res.error ?? "Erreur");
          else onDone();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Input name="firstName" placeholder="Prénom" required />
        <Input name="lastName" placeholder="Nom" required />
        <Input name="role" placeholder="Fonction" />
        <Input name="phone" placeholder="Téléphone" />
        <Input name="email" placeholder="Email" type="email" className="col-span-2" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Ajout..." : "Ajouter"}
        </Button>
      </div>
    </form>
  );
}
