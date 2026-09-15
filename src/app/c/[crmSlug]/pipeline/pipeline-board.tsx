"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Card, Badge } from "@/components/ui/card";
import { Modal } from "@/components/modal";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { formatDate, cn } from "@/lib/utils";
import { moveOpportunity } from "@/server/pipeline/actions";
import { OpportunityForm, type OpportunityFormInitial } from "./opportunity-form";
import { StageSettingsButton } from "./stage-settings";

export interface StageData {
  id: string;
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

export interface OpportunityCard {
  id: string;
  title: string;
  amount: number | null;
  stageId: string;
  position: number;
  ownerName: string;
  ownerColor: string;
  entityName: string | null;
  entityHref: string | null;
  prospectScore: number | null;
  lastActivityAt: string;
  nextAction: string | null;
  clientId: string | null;
  prospectId: string | null;
}

interface Option {
  id: string;
  company: string;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

function groupByStage(opportunities: OpportunityCard[], stages: StageData[]): Record<string, OpportunityCard[]> {
  const map: Record<string, OpportunityCard[]> = {};
  for (const s of stages) map[s.id] = [];
  for (const o of opportunities) {
    if (!map[o.stageId]) map[o.stageId] = [];
    map[o.stageId]!.push(o);
  }
  for (const stageId of Object.keys(map)) {
    map[stageId]!.sort((a, b) => a.position - b.position);
  }
  return map;
}

export function PipelineBoard({
  crmId,
  crmSlug,
  stages,
  opportunities,
  clients,
  prospects,
  members,
  currentUserId,
  canCreate,
  canManageSettings,
}: {
  crmId: string;
  crmSlug: string;
  stages: StageData[];
  opportunities: OpportunityCard[];
  clients: Option[];
  prospects: Option[];
  members: Member[];
  currentUserId: string;
  canCreate: boolean;
  canManageSettings: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(() => groupByStage(opportunities, stages));
  const [activeCard, setActiveCard] = useState<OpportunityCard | null>(null);
  const [, startTransition] = useTransition();
  const [newOpportunityStageId, setNewOpportunityStageId] = useState<string | null>(null);
  const [editOpportunity, setEditOpportunity] = useState<OpportunityCard | null>(null);

  useEffect(() => {
    setColumns(groupByStage(opportunities, stages));
  }, [opportunities, stages]);

  useRealtimeChannel(`private-crm-${crmId}`, {
    "opportunity.upserted": () => router.refresh(),
    "opportunity.moved": () => router.refresh(),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function findContainer(id: string): string | null {
    if (columns[id]) return id;
    for (const stageId of Object.keys(columns)) {
      if (columns[stageId]!.some((c) => c.id === id)) return stageId;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    for (const stageId of Object.keys(columns)) {
      const found = columns[stageId]!.find((c) => c.id === id);
      if (found) {
        setActiveCard(found);
        return;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const fromStageId = findContainer(activeId);
    const toStageId = columns[overId] ? overId : findContainer(overId);
    if (!fromStageId || !toStageId) return;

    let toPosition = 0;
    let movedCard: OpportunityCard | null = null;

    setColumns((prev) => {
      const fromItems = [...(prev[fromStageId] ?? [])];
      const activeIndex = fromItems.findIndex((c) => c.id === activeId);
      if (activeIndex === -1) return prev;
      const [moved] = fromItems.splice(activeIndex, 1);
      movedCard = moved!;
      const toItems = fromStageId === toStageId ? fromItems : [...(prev[toStageId] ?? [])];
      let overIndex = toItems.findIndex((c) => c.id === overId);
      if (overIndex === -1) overIndex = toItems.length;
      toItems.splice(overIndex, 0, { ...moved!, stageId: toStageId });
      toPosition = overIndex;
      return { ...prev, [fromStageId]: fromStageId === toStageId ? toItems : fromItems, [toStageId]: toItems };
    });

    if (fromStageId === toStageId && !movedCard) return;

    const toStage = stages.find((s) => s.id === toStageId);
    if (!toStage) return;

    let lostReason: string | undefined;
    if (toStage.isLost) {
      const input = window.prompt("Motif de la perte de cette opportunité :");
      if (!input || !input.trim()) {
        router.refresh();
        return;
      }
      lostReason = input.trim();
    }

    startTransition(async () => {
      const res = await moveOpportunity(crmId, { opportunityId: activeId, toStageId, toPosition, lostReason });
      if (!res.ok) {
        alert(res.error ?? "Impossible de déplacer cette opportunité.");
        router.refresh();
      }
    });
  }

  const stagesWithCount = stages.map((s) => ({
    ...s,
    opportunityCount: columns[s.id]?.length ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {canManageSettings && <StageSettingsButton crmId={crmId} stages={stagesWithCount} />}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="kanban-scroll flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              cards={columns[stage.id] ?? []}
              crmSlug={crmSlug}
              canCreate={canCreate}
              onAdd={() => setNewOpportunityStageId(stage.id)}
              onEdit={(card) => setEditOpportunity(card)}
            />
          ))}
          {stages.length === 0 && (
            <p className="text-sm text-muted">Aucune étape configurée pour ce pipeline.</p>
          )}
        </div>
        <DragOverlay>{activeCard ? <CardView card={activeCard} crmSlug={crmSlug} dragging /> : null}</DragOverlay>
      </DndContext>

      <Modal
        open={!!newOpportunityStageId}
        onClose={() => setNewOpportunityStageId(null)}
        title="Nouvelle opportunité"
        width="lg"
      >
        <OpportunityForm
          crmId={crmId}
          stages={stages}
          clients={clients}
          prospects={prospects}
          members={members}
          currentUserId={currentUserId}
          defaultStageId={newOpportunityStageId ?? undefined}
          onSuccess={() => {
            setNewOpportunityStageId(null);
            router.refresh();
          }}
        />
      </Modal>

      <Modal open={!!editOpportunity} onClose={() => setEditOpportunity(null)} title="Modifier l'opportunité" width="lg">
        {editOpportunity && (
          <OpportunityForm
            crmId={crmId}
            stages={stages}
            clients={clients}
            prospects={prospects}
            members={members}
            currentUserId={currentUserId}
            opportunity={
              {
                id: editOpportunity.id,
                title: editOpportunity.title,
                amount: editOpportunity.amount,
                ownerId: members.find((m) => `${m.firstName} ${m.lastName}` === editOpportunity.ownerName)?.id ?? currentUserId,
                clientId: editOpportunity.clientId,
                prospectId: editOpportunity.prospectId,
                stageId: editOpportunity.stageId,
                nextAction: editOpportunity.nextAction,
              } satisfies OpportunityFormInitial
            }
            onSuccess={() => {
              setEditOpportunity(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Column({
  stage,
  cards,
  crmSlug,
  canCreate,
  onAdd,
  onEdit,
}: {
  stage: StageData;
  cards: OpportunityCard[];
  crmSlug: string;
  canCreate: boolean;
  onAdd: () => void;
  onEdit: (card: OpportunityCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = cards.reduce((sum, c) => sum + (c.amount ?? 0), 0);

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-text">{stage.name}</span>
          <Badge variant="default">{cards.length}</Badge>
        </div>
        {canCreate && (
          <button onClick={onAdd} className="text-muted hover:text-brand" aria-label={`Ajouter dans ${stage.name}`}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      {total > 0 && (
        <p className="border-b border-border px-3 py-1.5 text-xs text-muted">{total.toLocaleString("fr-FR")} € potentiel</p>
      )}
      <div
        ref={setNodeRef}
        className={cn("flex min-h-24 flex-1 flex-col gap-2 p-2.5 transition-colors", isOver && "bg-brand/5")}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCardView key={card.id} card={card} crmSlug={crmSlug} onEdit={() => onEdit(card)} />
          ))}
        </SortableContext>
        {cards.length === 0 && <p className="px-1 py-2 text-center text-xs text-muted">Aucune opportunité</p>}
      </div>
    </div>
  );
}

function SortableCardView({ card, crmSlug, onEdit }: { card: OpportunityCard; crmSlug: string; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardView card={card} crmSlug={crmSlug} onEdit={onEdit} />
    </div>
  );
}

function CardView({
  card,
  crmSlug,
  onEdit,
  dragging,
}: {
  card: OpportunityCard;
  crmSlug: string;
  onEdit?: () => void;
  dragging?: boolean;
}) {
  return (
    <Card className={cn("cursor-grab select-none p-3 active:cursor-grabbing", dragging && "shadow-lg")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text">{card.title}</p>
        {onEdit && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="shrink-0 text-[11px] text-muted hover:text-brand"
          >
            Modifier
          </button>
        )}
      </div>
      {card.entityName && (
        <p className="mt-0.5 truncate text-xs text-muted">
          {card.entityHref ? (
            <Link href={`/c/${crmSlug}${card.entityHref}`} onPointerDown={(e) => e.stopPropagation()} className="hover:text-brand">
              {card.entityName}
            </Link>
          ) : (
            card.entityName
          )}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: card.ownerColor }}
          title={card.ownerName}
        >
          {card.ownerName
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)}
        </span>
        {card.amount != null && <Badge variant="default">{card.amount.toLocaleString("fr-FR")} €</Badge>}
        {card.prospectScore != null && (
          <Badge variant={card.prospectScore >= 60 ? "danger" : card.prospectScore >= 30 ? "warning" : "default"}>
            Score {card.prospectScore}
          </Badge>
        )}
      </div>
      {card.nextAction && <p className="mt-1.5 truncate text-xs text-text">→ {card.nextAction}</p>}
      <p className="mt-1 text-[11px] text-muted">Dernière activité : {formatDate(card.lastActivityAt)}</p>
    </Card>
  );
}
