"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, MapPin, Calendar, Pencil, Trash2, UserPlus, X, FileText, Lock } from "lucide-react";
import {
  createChantier,
  updateChantier,
  deleteChantier,
  assignToChantier,
  removeAssignment,
  listChantiers,
  listCrmMembersForPlanning,
} from "@/server/planning/actions";
import { depositMissionOrder } from "@/server/mission-order/actions";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Card, Badge } from "@/components/ui/card";
import { cn, formatDate, initials } from "@/lib/utils";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { PlanningCalendar } from "./planning-calendar";

type Chantier = Awaited<ReturnType<typeof listChantiers>>[number];
type Assignment = Chantier["assignments"][number];
type Member = Awaited<ReturnType<typeof listCrmMembersForPlanning>>[number];

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Prévu",
  IN_PROGRESS: "En cours",
  COMPLETED: "Terminé",
};
const STATUS_VARIANT: Record<string, "default" | "brand" | "success"> = {
  PLANNED: "default",
  IN_PROGRESS: "brand",
  COMPLETED: "success",
};

function toDateInputValue(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10);
}

export function PlanningClient({
  crmId,
  canManage,
  isOuvrier = false,
  currentUserId,
  initialChantiers,
  members,
}: {
  crmId: string;
  canManage: boolean;
  isOuvrier?: boolean;
  currentUserId: string;
  initialChantiers: Chantier[];
  members: Member[];
}) {
  const [chantiers, setChantiers] = useState(initialChantiers);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Chantier | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assigningTo, setAssigningTo] = useState<Chantier | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missionOrderNotice, setMissionOrderNotice] = useState<string | null>(null);
  const [missionOrderPending, startMissionOrderTransition] = useTransition();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useRealtimeChannel(`private-crm-${crmId}`, {
    "notification.created": () => router.refresh(),
  });

  async function refresh() {
    const list = await listChantiers(crmId);
    setChantiers(list);
    router.refresh();
  }

  function openCreate() {
    setEditing(null);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(c: Chantier) {
    setEditing(c);
    setError(null);
    setFormOpen(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = editing
        ? await updateChantier(crmId, editing.id, formData)
        : await createChantier(crmId, formData);
      if (!res.ok) {
        setError(res.error ?? "Erreur.");
        return;
      }
      setFormOpen(false);
      await refresh();
    });
  }

  function handleDelete(c: Chantier) {
    if (!confirm(`Supprimer le chantier "${c.name}" ? Cette action est irréversible.`)) return;
    startTransition(async () => {
      await deleteChantier(crmId, c.id);
      await refresh();
    });
  }

  function closeAssignModal() {
    setAssigningTo(null);
    setEditingAssignment(null);
    setMissionOrderNotice(null);
  }

  const now = new Date();
  const detailChantier = chantiers.find((c) => c.id === detailId) ?? null;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nouveau chantier
          </Button>
        </div>
      )}

      {chantiers.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">
          {isOuvrier ? "Vous n'êtes affecté à aucun chantier pour le moment." : "Aucun chantier planifié pour le moment."}
        </Card>
      )}

      {chantiers.length > 0 && (
        <PlanningCalendar chantiers={chantiers} currentUserId={currentUserId} onSelect={setDetailId} />
      )}

      <Modal open={!!detailChantier} onClose={() => setDetailId(null)} title={detailChantier?.name ?? ""}>
        {detailChantier && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: detailChantier.color }} />
                <h3 className="font-medium text-text">{detailChantier.name}</h3>
              </div>
              <Badge variant={STATUS_VARIANT[detailChantier.status]}>{STATUS_LABELS[detailChantier.status]}</Badge>
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted">
              <p className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(detailChantier.startDate)} → {formatDate(detailChantier.endDate)}
                {new Date(detailChantier.startDate) <= now && now <= new Date(detailChantier.endDate) && (
                  <Badge variant="warning" className="ml-1">
                    En cours actuellement
                  </Badge>
                )}
              </p>
              {detailChantier.address && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {detailChantier.address}
                </p>
              )}
            </div>
            {detailChantier.description && <p className="mt-2 text-sm text-text">{detailChantier.description}</p>}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {detailChantier.assignments.length === 0 && <span className="text-xs text-muted">Personne affecté.</span>}
              {detailChantier.assignments.map((a) => {
                const isForeman = a.user.crmAccess[0]?.isForeman ?? false;
                return (
                  <span
                    key={a.id}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-1 text-xs",
                      isForeman ? "bg-brand/10 text-brand" : "bg-bg-subtle",
                      canManage && "cursor-pointer hover:ring-1 hover:ring-brand/40"
                    )}
                    title={
                      canManage
                        ? "Cliquer pour modifier l'affectation (adresse, indemnités de trajet...)"
                        : isForeman
                          ? `Chef de chantier${a.note ? ` — ${a.note}` : ""}`
                          : (a.note ?? undefined)
                    }
                    onClick={
                      canManage
                        ? () => {
                            setAssigningTo(detailChantier);
                            setEditingAssignment(a);
                            setMissionOrderNotice(null);
                          }
                        : undefined
                    }
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: a.user.color }}
                    >
                      {initials(a.user.firstName, a.user.lastName)}
                    </span>
                    {a.user.firstName}
                    {isForeman && <span className="font-semibold">(chef)</span>}
                    {canManage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startTransition(async () => {
                            await removeAssignment(crmId, detailChantier.id, a.user.id);
                            await refresh();
                          });
                        }}
                        className="text-muted hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            {canManage && (
              <div className="mt-4 flex justify-end gap-1 border-t border-border pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAssigningTo(detailChantier);
                    setEditingAssignment(null);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Affecter
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDetailId(null);
                    openEdit(detailChantier);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDetailId(null);
                    handleDelete(detailChantier);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Modifier le chantier" : "Nouveau chantier"}>
        <form action={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Nom *</Label>
            <Input id="name" name="name" required defaultValue={editing?.name} />
          </div>
          <div>
            <Label htmlFor="address">Adresse</Label>
            <Input id="address" name="address" defaultValue={editing?.address ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="startDate">Début *</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                required
                defaultValue={editing ? toDateInputValue(editing.startDate) : undefined}
              />
            </div>
            <div>
              <Label htmlFor="endDate">Fin *</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                required
                defaultValue={editing ? toDateInputValue(editing.endDate) : undefined}
              />
            </div>
          </div>
          {editing && (
            <div>
              <Label htmlFor="status">Statut</Label>
              <Select id="status" name="status" defaultValue={editing.status}>
                <option value="PLANNED">Prévu</option>
                <option value="IN_PROGRESS">En cours</option>
                <option value="COMPLETED">Terminé</option>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={editing?.description ?? ""} />
          </div>
          <div>
            <Label htmlFor="color">Couleur</Label>
            <input
              id="color"
              name="color"
              type="color"
              defaultValue={editing?.color ?? "#0891b2"}
              className="h-9 w-16 rounded border border-border bg-surface"
            />
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium text-text">Indemnités du chantier</p>
            <p className="mb-2 text-xs text-muted">
              Montants communs à tous les salariés mobilisés sur ce chantier — le chef de chantier n&apos;aura qu&apos;à
              cocher lesquelles s&apos;appliquent sur chaque fiche de pointage.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="lunchAllowance">Repas midi (€)</Label>
                <Input
                  id="lunchAllowance"
                  name="lunchAllowance"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.lunchAllowance) : 0}
                />
              </div>
              <div>
                <Label htmlFor="dinnerAllowance">Repas soir (€)</Label>
                <Input
                  id="dinnerAllowance"
                  name="dinnerAllowance"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.dinnerAllowance) : 0}
                />
              </div>
              <div>
                <Label htmlFor="travelAllowance">Grand déplacement (€)</Label>
                <Input
                  id="travelAllowance"
                  name="travelAllowance"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.travelAllowance) : 0}
                />
              </div>
              <div>
                <Label htmlFor="maskBonus">Prime masque (€)</Label>
                <Input
                  id="maskBonus"
                  name="maskBonus"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.maskBonus) : 0}
                />
              </div>
              <div>
                <Label htmlFor="managementBonus">Prime management (€)</Label>
                <Input
                  id="managementBonus"
                  name="managementBonus"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.managementBonus) : 0}
                />
              </div>
              <div>
                <Label htmlFor="zoneBonus">Prime zone (€)</Label>
                <Input
                  id="zoneBonus"
                  name="zoneBonus"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.zoneBonus) : 0}
                />
              </div>
              <div>
                <Label htmlFor="postBonus">Prime poste (€)</Label>
                <Input
                  id="postBonus"
                  name="postBonus"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.postBonus) : 0}
                />
              </div>
              <div>
                <Label htmlFor="mealAllowance">Repas (€)</Label>
                <Input
                  id="mealAllowance"
                  name="mealAllowance"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.mealAllowance) : 9.81}
                />
              </div>
              <div>
                <Label htmlFor="clothingBonus">Prime habillage (€)</Label>
                <Input
                  id="clothingBonus"
                  name="clothingBonus"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? Number(editing.clothingBonus) : 0}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium text-text">Informations de mission</p>
            <p className="mb-2 text-xs text-muted">Utilisées pour générer l&apos;ordre de mission de chaque salarié affecté.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="missionNature">Nature de la mission</Label>
                <Input id="missionNature" name="missionNature" defaultValue={editing?.missionNature ?? ""} />
              </div>
              <div>
                <Label htmlFor="clientName">Nom du client</Label>
                <Input id="clientName" name="clientName" defaultValue={editing?.clientName ?? ""} />
              </div>
              <div>
                <Label htmlFor="siteContactName">Contact sur site</Label>
                <Input id="siteContactName" name="siteContactName" defaultValue={editing?.siteContactName ?? ""} />
              </div>
              <div>
                <Label htmlFor="siteContactPhone">Téléphone du contact</Label>
                <Input id="siteContactPhone" name="siteContactPhone" defaultValue={editing?.siteContactPhone ?? ""} />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="importantDocuments">Documents importants à emporter</Label>
              <Textarea
                id="importantDocuments"
                name="importantDocuments"
                placeholder="Ex : carnet d'accès, permis de conduire, pièce d'identité..."
                defaultValue={editing?.importantDocuments ?? ""}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!assigningTo}
        onClose={closeAssignModal}
        title={
          editingAssignment
            ? `Modifier l'affectation — ${editingAssignment.user.firstName} ${editingAssignment.user.lastName}`
            : `Affecter — ${assigningTo?.name ?? ""}`
        }
      >
        {assigningTo && (
          <form
            action={(fd) =>
              startTransition(async () => {
                const res = await assignToChantier(crmId, assigningTo.id, fd);
                if (res.ok) {
                  closeAssignModal();
                  await refresh();
                }
              })
            }
            className="space-y-3"
          >
            {editingAssignment ? (
              <input type="hidden" name="userId" value={editingAssignment.user.id} />
            ) : (
              <div>
                <Label htmlFor="userId">Personne *</Label>
                <Select id="userId" name="userId" required defaultValue="">
                  <option value="" disabled>
                    Sélectionner...
                  </option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} (
                      {m.category === "OUVRIER" ? (m.isForeman ? "Ouvrier — Chef de chantier" : "Ouvrier") : "Commercial"})
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted">
                  Le profil « chef de chantier » se définit sur la fiche de l&apos;utilisateur (Administration → Utilisateurs)
                  et lui donne accès aux feuilles de pointage salariés et client de tout chantier auquel il est affecté.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="a-startDate">Début (optionnel)</Label>
                <Input
                  id="a-startDate"
                  name="startDate"
                  type="date"
                  defaultValue={editingAssignment?.startDate ? toDateInputValue(editingAssignment.startDate) : undefined}
                />
              </div>
              <div>
                <Label htmlFor="a-endDate">Fin (optionnel)</Label>
                <Input
                  id="a-endDate"
                  name="endDate"
                  type="date"
                  defaultValue={editingAssignment?.endDate ? toDateInputValue(editingAssignment.endDate) : undefined}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                name="note"
                placeholder="Ex : chef d'équipe, poste occupé..."
                defaultValue={editingAssignment?.note ?? ""}
              />
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-sm font-medium text-text">Mission de ce salarié sur ce chantier</p>
              <p className="mb-2 text-xs text-muted">
                Alimente la fiche de pointage (remboursements km/trajet) et l&apos;ordre de mission.
              </p>
              <div>
                <Label htmlFor="workerAddress">Adresse du salarié</Label>
                <Input
                  id="workerAddress"
                  name="workerAddress"
                  defaultValue={editingAssignment?.workerAddress ?? ""}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="distanceKm">Distance aller-retour (km)</Label>
                  <Input
                    id="distanceKm"
                    name="distanceKm"
                    type="number"
                    step="0.1"
                    min="0"
                    defaultValue={editingAssignment?.distanceKm ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="kmRate">Taux au km (€)</Label>
                  <Input
                    id="kmRate"
                    name="kmRate"
                    type="number"
                    step="0.001"
                    min="0"
                    defaultValue={editingAssignment?.kmRate ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="travelDurationHours">Durée de trajet (h)</Label>
                  <Input
                    id="travelDurationHours"
                    name="travelDurationHours"
                    type="number"
                    step="0.1"
                    min="0"
                    defaultValue={editingAssignment?.travelDurationHours ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="travelHourlyRate">Taux horaire de trajet (€)</Label>
                  <Input
                    id="travelHourlyRate"
                    name="travelHourlyRate"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={editingAssignment?.travelHourlyRate ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="sncfExpense">Frais SNCF (€)</Label>
                  <Input
                    id="sncfExpense"
                    name="sncfExpense"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={editingAssignment?.sncfExpense ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="roomDeduction">Retenue de chambre (€)</Label>
                  <Input
                    id="roomDeduction"
                    name="roomDeduction"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={editingAssignment?.roomDeduction ?? ""}
                  />
                </div>
              </div>
            </div>

            {editingAssignment && (
              <div className="border-t border-border pt-3">
                <p className="text-sm font-medium text-text">Ordre de mission</p>
                <p className="mb-2 text-xs text-muted">
                  Généré automatiquement à partir des informations du chantier et de cette affectation.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/mission-order/${assigningTo.id}/${editingAssignment.user.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button type="button" variant="outline" size="sm">
                      <FileText className="h-3.5 w-3.5" /> Aperçu PDF
                    </Button>
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={missionOrderPending}
                    onClick={() =>
                      startMissionOrderTransition(async () => {
                        const res = await depositMissionOrder(crmId, assigningTo.id, editingAssignment.user.id);
                        setMissionOrderNotice(res.ok ? "Déposé dans le coffre-fort du salarié (dossier « Ordre de mission »)." : (res.error ?? "Erreur."));
                      })
                    }
                  >
                    <Lock className="h-3.5 w-3.5" /> {missionOrderPending ? "Dépôt..." : "Déposer au coffre-fort"}
                  </Button>
                </div>
                {missionOrderNotice && <p className="mt-1 text-xs text-muted">{missionOrderNotice}</p>}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={closeAssignModal}>
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {editingAssignment ? "Enregistrer" : "Affecter"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
