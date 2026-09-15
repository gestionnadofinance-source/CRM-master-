"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, Mail, CalendarPlus, CheckSquare, FileText, Pencil, Trash2, Plus, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { DocumentList } from "@/components/documents/document-list";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { formatDate } from "@/lib/utils";
import { translateActivityAction } from "@/lib/activity-labels";
import { ClientForm, type ClientFormInitial } from "../client-form";
import {
  addClientContact,
  deleteClientContact,
  addClientCollaborator,
  removeClientCollaborator,
  deleteClient,
} from "@/server/clients/actions";
import type { ClientStatus } from "@prisma/client";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

interface ClientData {
  id: string;
  company: string;
  sector: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  activity: string | null;
  size: string | null;
  siret: string | null;
  status: ClientStatus;
  notes: string | null;
  sourceId: string | null;
  sourceName: string | null;
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string; color: string };
  createdAt: string;
  tags: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; role: string | null; phone: string | null; email: string | null }[];
  collaborators: { id: string; firstName: string; lastName: string }[];
  convertedFrom: { id: string; company: string } | null;
}

interface Opportunity {
  id: string;
  title: string;
  amount: number | null;
  stageName: string;
  stageColor: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  userName: string;
}

export function ClientDetail({
  crmSlug,
  crmId,
  client,
  activity,
  opportunities,
  sources,
  tags,
  members,
  currentUserId,
  canEdit,
  canDelete,
}: {
  crmSlug: string;
  crmId: string;
  client: ClientData;
  activity: ActivityEntry[];
  opportunities: Opportunity[];
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  members: Member[];
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useRealtimeChannel(`private-crm-${crmId}`, {
    "client.upserted": () => router.refresh(),
  });

  const formInitial: ClientFormInitial = {
    id: client.id,
    company: client.company,
    sector: client.sector,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    email: client.email,
    address: client.address,
    activity: client.activity,
    size: client.size,
    siret: client.siret,
    status: client.status,
    sourceId: client.sourceId,
    ownerId: client.ownerId,
    notes: client.notes,
    tagIds: client.tags.map((t) => t.id),
  };

  const availableCollaborators = members.filter(
    (m) => m.id !== client.ownerId && !client.collaborators.some((c) => c.id === m.id)
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text">{client.company}</h1>
            <Badge variant={client.status === "ACTIVE" ? "success" : "default"}>
              {client.status === "ACTIVE" ? "Actif" : "Inactif"}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            Commercial : {client.owner.firstName} {client.owner.lastName} · Ajouté le {formatDate(client.createdAt)}
          </p>
          {client.convertedFrom && (
            <p className="mt-1 text-xs text-muted">
              Converti depuis le prospect{" "}
              <Link href={`/c/${crmSlug}/prospects/${client.convertedFrom.id}`} className="text-brand hover:underline">
                {client.convertedFrom.company}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {client.phone && (
            <a href={`tel:${client.phone}`}>
              <Button variant="outline" size="sm">
                <Phone className="h-4 w-4" /> Appeler
              </Button>
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`}>
              <Button variant="outline" size="sm">
                <Mail className="h-4 w-4" /> Email
              </Button>
            </a>
          )}
          <Link href={`/c/${crmSlug}/agenda?newForClient=${client.id}`}>
            <Button variant="outline" size="sm">
              <CalendarPlus className="h-4 w-4" /> Nouveau RDV
            </Button>
          </Link>
          <Link href={`/c/${crmSlug}/tasks?newForClient=${client.id}`}>
            <Button variant="outline" size="sm">
              <CheckSquare className="h-4 w-4" /> Nouvelle tâche
            </Button>
          </Link>
          <Link href={`/c/${crmSlug}/quotes?newForClient=${client.id}`}>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" /> Nouveau devis
            </Button>
          </Link>
          {canEdit && (
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Modifier
            </Button>
          )}
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Supprimer définitivement ${client.company} ?`)) return;
                startTransition(async () => {
                  const res = await deleteClient(crmId, client.id);
                  if (res.ok) router.push(`/c/${crmSlug}/clients`);
                });
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="Contact principal" value={[client.firstName, client.lastName].filter(Boolean).join(" ") || "—"} />
                <Field label="Téléphone" value={client.phone ?? "—"} />
                <Field label="Email" value={client.email ?? "—"} />
                <Field label="Adresse" value={client.address ?? "—"} />
                <Field label="Secteur" value={client.sector ?? "—"} />
                <Field label="Activité" value={client.activity ?? "—"} />
                <Field label="Taille" value={client.size ?? "—"} />
                <Field label="SIRET" value={client.siret ?? "—"} />
                <Field label="Source" value={client.sourceName ?? "—"} />
              </dl>
              {client.notes && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-text">{client.notes}</p>
                </div>
              )}
              {client.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {client.tags.map((t) => (
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
                  clientId={client.id}
                  onDone={() => {
                    setContactFormOpen(false);
                    router.refresh();
                  }}
                />
              )}
              {client.contacts.length === 0 && !contactFormOpen && (
                <p className="text-sm text-muted">Aucun contact additionnel.</p>
              )}
              <ul className="divide-y divide-border">
                {client.contacts.map((c) => (
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
                            await deleteClientContact(crmId, client.id, c.id);
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
              <DocumentList crmId={crmId} entityType="CLIENT" entityId={client.id} canDelete={canDelete} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Collaborateurs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1.5">
                {client.collaborators.length === 0 && <p className="text-sm text-muted">Aucun collaborateur secondaire.</p>}
                {client.collaborators.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span className="text-text">
                      {c.firstName} {c.lastName}
                    </span>
                    {canEdit && (
                      <button
                        className="text-muted hover:text-red-500"
                        onClick={() =>
                          startTransition(async () => {
                            await removeClientCollaborator(crmId, client.id, c.id);
                            router.refresh();
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && availableCollaborators.length > 0 && (
                <AddCollaboratorForm
                  crmId={crmId}
                  clientId={client.id}
                  options={availableCollaborators}
                  onDone={() => router.refresh()}
                />
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

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le client" width="lg">
        <ClientForm
          crmId={crmId}
          crmSlug={crmSlug}
          sources={sources}
          tags={tags}
          members={members}
          currentUserId={currentUserId}
          client={formInitial}
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

function ContactForm({ crmId, clientId, onDone }: { crmId: string; clientId: string; onDone: () => void }) {
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
          const res = await addClientContact(crmId, clientId, fd);
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

function AddCollaboratorForm({
  crmId,
  clientId,
  options,
  onDone,
}: {
  crmId: string;
  clientId: string;
  options: Member[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(options[0]?.id ?? "");

  return (
    <div className="flex items-center gap-2">
      <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="flex-1">
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.firstName} {m.lastName}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !selected}
        onClick={() =>
          startTransition(async () => {
            await addClientCollaborator(crmId, clientId, selected);
            onDone();
          })
        }
      >
        Ajouter
      </Button>
    </div>
  );
}
