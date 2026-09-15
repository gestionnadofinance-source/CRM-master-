"use server";

// Messagerie interne — voir prisma/schema.prisma pour le schéma des
// modèles MessageThread / MessageThreadParticipant / Message /
// MessageAttachment. Règle absolue : un thread DIRECT n'est jamais visible
// ni accessible à quelqu'un d'autre que ses deux participants, même si
// cette personne a accès au même CRM. Toute lecture ou écriture d'un
// thread doit donc vérifier à la fois l'appartenance au CRM courant
// (assertBelongsToCrm) ET l'appartenance de l'utilisateur au thread
// (MessageThreadParticipant), jamais l'une sans l'autre.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { requireCrmAccessBySlug, assertBelongsToCrm, type TenantContext } from "@/server/tenant";
import { publishToCrm, publishToUser } from "@/lib/realtime";
import { uploadDocument } from "@/server/documents/actions";
import { revalidatePath } from "next/cache";
import { DocumentEntity, ThreadType, Prisma, type MessageThread } from "@prisma/client";

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

/**
 * Charge un thread, vérifie qu'il appartient bien au CRM courant, PUIS
 * vérifie que l'utilisateur courant en est réellement participant. Les deux
 * contrôles sont nécessaires : le premier empêche une fuite inter-CRM, le
 * second empêche un utilisateur du même CRM (mais hors conversation) de
 * lire un échange privé.
 */
async function requireParticipant(threadId: string, tenant: TenantContext, userId: string) {
  const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
  if (!thread) {
    throw new Error("Conversation introuvable.");
  }
  assertBelongsToCrm(thread.crmId, tenant, "Conversation");

  const participant = await prisma.messageThreadParticipant.findUnique({
    where: { threadId_userId: { threadId, userId } },
  });
  if (!participant) {
    throw new Error("Vous ne participez pas à cette conversation.");
  }
  return { thread, participant };
}

/**
 * Un utilisateur ne peut être invité dans une conversation d'un CRM que
 * s'il a effectivement un UserCrmAccess pour ce CRM (ou est admin global) —
 * jamais un utilisateur "au global" sans lien avec ce CRM précis.
 */
async function isEligibleCrmMember(crmId: string, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGlobalAdmin: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return false;
  if (user.isGlobalAdmin) return true;
  const access = await prisma.userCrmAccess.findUnique({
    where: { userId_crmId: { userId, crmId } },
  });
  return !!access;
}

function threadDisplayName(
  thread: Pick<MessageThread, "type" | "name">,
  otherParticipants: { user: { firstName: string; lastName: string } }[]
): string {
  if (thread.type === "GROUP") return thread.name ?? "Groupe";
  const other = otherParticipants[0];
  return other ? `${other.user.firstName} ${other.user.lastName}` : "Conversation";
}

// ----------------------------------------------------------------------------
// Lecture
// ----------------------------------------------------------------------------

/**
 * Membres du CRM courant éligibles à une conversation (jamais d'utilisateurs
 * d'un autre CRM). Un commercial ne doit voir que les admins et les autres
 * commerciaux comme contacts possibles — jamais un ouvrier/chef de chantier,
 * qui de toute façon n'a pas accès à la messagerie (voir le layout CRM).
 */
export async function listCrmMembers(crmSlug: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const [access, globalAdmins] = await Promise.all([
    prisma.userCrmAccess.findMany({
      where: { crmId: tenant.crmId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, color: true, status: true } },
      },
    }),
    prisma.user.findMany({
      where: { isGlobalAdmin: true, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, color: true, status: true },
    }),
  ]);

  const map = new Map<string, { id: string; firstName: string; lastName: string; color: string }>();
  for (const a of access) {
    if (a.user.status === "ACTIVE" && a.category === "COMMERCIAL") map.set(a.user.id, a.user);
  }
  for (const u of globalAdmins) map.set(u.id, u);
  map.delete(ctx.user.id);

  return Array.from(map.values()).sort((a, b) => a.firstName.localeCompare(b.firstName, "fr"));
}

/** Liste des conversations de l'utilisateur courant, strictement dans ce CRM. */
export async function listThreads(crmSlug: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const threads = await prisma.messageThread.findMany({
    where: { crmId: tenant.crmId, participants: { some: { userId: ctx.user.id } } },
    include: {
      participants: {
        include: { user: { select: { id: true, firstName: true, lastName: true, color: true } } },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, createdAt: true, authorId: true },
      },
    },
  });

  const result = threads.map((t) => {
    const me = t.participants.find((p) => p.userId === ctx.user.id)!;
    const others = t.participants.filter((p) => p.userId !== ctx.user.id);
    const lastMessage = t.messages[0] ?? null;
    const lastActivityAt = lastMessage?.createdAt ?? t.createdAt;
    const unread = !!lastMessage && (!me.lastReadAt || lastMessage.createdAt > me.lastReadAt);

    return {
      id: t.id,
      type: t.type,
      name: threadDisplayName(t, others),
      color: t.type === ThreadType.DIRECT ? others[0]?.user.color ?? "#3b6bf5" : "#3b6bf5",
      lastMessage: lastMessage
        ? { body: lastMessage.body, createdAt: lastMessage.createdAt, mine: lastMessage.authorId === ctx.user.id }
        : null,
      lastActivityAt,
      unread,
      participantCount: t.participants.length,
    };
  });

  result.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return result;
}

/**
 * Nombre de messages chargés par page — voir getThreadMessages. Choisi assez
 * large pour couvrir la quasi-totalité des ouvertures de conversation en un
 * seul aller-retour, sans jamais relire un fil entier quel que soit son
 * historique.
 */
const MESSAGE_PAGE_SIZE = 50;
/** Plafond de sécurité sur les messages "après" un curseur (voir plus bas) — ne borne pas l'usage normal (quelques messages entre deux rafraîchissements), seulement les cas dégénérés (fil resté ouvert très longtemps sans rafraîchissement réussi). */
const MESSAGE_AFTER_CAP = 200;

const messageInclude = {
  author: { select: { id: true, firstName: true, lastName: true, color: true } },
  attachments: {
    include: { document: { select: { id: true, fileName: true, mimeType: true, size: true } } },
  },
} as const;

type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function mapMessage(m: MessageWithRelations) {
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    author: m.author,
    attachments: m.attachments.map((a) => a.document),
  };
}

/**
 * Détail d'une conversation + une page de ses messages. Marque également la
 * conversation comme lue par l'utilisateur courant.
 *
 * Pagination par curseur, dans les deux sens, pour ne jamais charger un fil
 * entier quel que soit son historique (voir l'audit — un `findMany` sans
 * borne dégradait le temps d'ouverture au fil du temps) :
 * - Aucune option : page la plus récente (chargement initial), avec
 *   `hasMoreBefore` indiquant s'il existe des messages plus anciens.
 * - `{ before: id }` : page précédente (plus ancienne) que ce message —
 *   pour "charger les messages précédents", à préfixer à la liste locale.
 * - `{ after: id }` : tous les messages plus récents que ce message (plafonnés,
 *   voir MESSAGE_AFTER_CAP) — pour le rafraîchissement périodique/temps réel,
 *   à ajouter à la fin de la liste locale sans jamais retirer ce qui est déjà
 *   affiché (évite le "trou" qu'une fenêtre glissante "derniers N, remplace
 *   tout" créerait entre l'historique déjà chargé et la fenêtre courante).
 */
export async function getThreadMessages(
  crmSlug: string,
  threadId: string,
  options?: { before?: string; after?: string }
) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  const { thread } = await requireParticipant(threadId, tenant, ctx.user.id);

  const baseWhere = { crmId: tenant.crmId, threadId: thread.id };

  let messages: MessageWithRelations[];
  let hasMoreBefore = false;

  if (options?.after) {
    const anchor = await prisma.message.findUnique({ where: { id: options.after }, select: { createdAt: true } });
    messages = anchor
      ? await prisma.message.findMany({
          where: { ...baseWhere, createdAt: { gt: anchor.createdAt } },
          orderBy: { createdAt: "asc" },
          take: MESSAGE_AFTER_CAP,
          include: messageInclude,
        })
      : [];
  } else {
    const anchorCreatedAt = options?.before
      ? (await prisma.message.findUnique({ where: { id: options.before }, select: { createdAt: true } }))?.createdAt
      : undefined;
    const page = await prisma.message.findMany({
      where: options?.before ? { ...baseWhere, createdAt: { lt: anchorCreatedAt ?? new Date(0) } } : baseWhere,
      orderBy: { createdAt: "desc" },
      take: MESSAGE_PAGE_SIZE,
      include: messageInclude,
    });
    hasMoreBefore = page.length === MESSAGE_PAGE_SIZE;
    messages = page.reverse();
  }

  const participants = await prisma.messageThreadParticipant.findMany({
    where: { threadId: thread.id },
    include: { user: { select: { id: true, firstName: true, lastName: true, color: true } } },
  });

  await prisma.messageThreadParticipant.update({
    where: { threadId_userId: { threadId: thread.id, userId: ctx.user.id } },
    data: { lastReadAt: new Date() },
  });

  return {
    thread: {
      id: thread.id,
      type: thread.type,
      name: threadDisplayName(
        thread,
        participants.filter((p) => p.userId !== ctx.user.id)
      ),
    },
    participants: participants.map((p) => ({
      id: p.user.id,
      firstName: p.user.firstName,
      lastName: p.user.lastName,
      color: p.user.color,
    })),
    messages: messages.map(mapMessage),
    hasMoreBefore,
  };
}

// ----------------------------------------------------------------------------
// Écriture
// ----------------------------------------------------------------------------

const directThreadSchema = z.object({ otherUserId: z.string().trim().min(1) });

/** Démarre (ou récupère) la conversation 1:1 entre l'utilisateur courant et un autre membre du CRM. */
export async function startDirectThread(crmSlug: string, otherUserId: string) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const parsed = directThreadSchema.safeParse({ otherUserId });
  if (!parsed.success) {
    return { ok: false as const, error: "Destinataire invalide." };
  }
  const targetId = parsed.data.otherUserId;

  if (targetId === ctx.user.id) {
    return { ok: false as const, error: "Impossible de démarrer une conversation avec soi-même." };
  }
  if (!(await isEligibleCrmMember(tenant.crmId, targetId))) {
    return { ok: false as const, error: "Cet utilisateur n'a pas accès à ce CRM." };
  }

  // Réutilise un éventuel thread DIRECT déjà existant entre ces deux
  // utilisateurs dans CE CRM plutôt que d'en recréer un doublon — un thread
  // DIRECT créé par cette fonction ne contient jamais que ces deux
  // participants, l'intersection suffit donc à l'identifier.
  const existing = await prisma.messageThread.findFirst({
    where: {
      crmId: tenant.crmId,
      type: ThreadType.DIRECT,
      AND: [
        { participants: { some: { userId: ctx.user.id } } },
        { participants: { some: { userId: targetId } } },
      ],
    },
  });
  if (existing) {
    return { ok: true as const, threadId: existing.id };
  }

  const thread = await prisma.messageThread.create({
    data: {
      crmId: tenant.crmId,
      type: ThreadType.DIRECT,
      createdById: ctx.user.id,
      participants: {
        create: [{ userId: ctx.user.id, lastReadAt: new Date() }, { userId: targetId }],
      },
    },
  });

  revalidatePath(`/c/${tenant.crmSlug}/messages`);
  return { ok: true as const, threadId: thread.id };
}

const groupThreadSchema = z.object({
  name: z.string().trim().min(1, "Le nom du groupe est obligatoire.").max(100, "Nom trop long (100 caractères max)."),
  participantIds: z.array(z.string().trim().min(1)).min(1, "Sélectionnez au moins un participant."),
});

/** Crée une conversation de groupe. L'auteur y est automatiquement ajouté. */
export async function startGroupThread(crmSlug: string, input: { name: string; participantIds: string[] }) {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);

  const parsed = groupThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Entrée invalide." };
  }

  const uniqueIds = Array.from(new Set(parsed.data.participantIds)).filter((id) => id !== ctx.user.id);
  if (uniqueIds.length === 0) {
    return { ok: false as const, error: "Sélectionnez au moins un participant." };
  }
  for (const id of uniqueIds) {
    if (!(await isEligibleCrmMember(tenant.crmId, id))) {
      return { ok: false as const, error: "Un des participants sélectionnés n'a pas accès à ce CRM." };
    }
  }

  const thread = await prisma.messageThread.create({
    data: {
      crmId: tenant.crmId,
      type: ThreadType.GROUP,
      name: parsed.data.name,
      createdById: ctx.user.id,
      participants: {
        create: [{ userId: ctx.user.id, lastReadAt: new Date() }, ...uniqueIds.map((userId) => ({ userId }))],
      },
    },
  });

  revalidatePath(`/c/${tenant.crmSlug}/messages`);
  return { ok: true as const, threadId: thread.id };
}

const sendMessageSchema = z.object({ body: z.string().trim().max(5000, "Message trop long.") });

export interface SendMessageResult {
  ok: boolean;
  error?: string;
  message?: {
    id: string;
    threadId: string;
    body: string;
    createdAt: Date;
    author: { id: string; firstName: string; lastName: string; color: string };
    attachments: { id: string; fileName: string; mimeType: string; size: number }[];
  };
}

/**
 * Envoie un message (texte et/ou pièce jointe) dans une conversation dont
 * l'utilisateur courant doit être participant. Notifie uniquement les
 * AUTRES participants (jamais l'auteur, jamais tout le CRM).
 */
export async function sendMessage(crmSlug: string, threadId: string, formData: FormData): Promise<SendMessageResult> {
  const ctx = await requireAuth();
  const tenant = await requireCrmAccessBySlug(ctx, crmSlug);
  const { thread } = await requireParticipant(threadId, tenant, ctx.user.id);

  const parsed = sendMessageSchema.safeParse({ body: String(formData.get("body") ?? "") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Message invalide." };
  }

  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const body = parsed.data.body;
  if (!body && !hasFile) {
    return { ok: false, error: "Le message ne peut pas être vide." };
  }

  const message = await prisma.message.create({
    data: {
      crmId: tenant.crmId,
      threadId: thread.id,
      authorId: ctx.user.id,
      body,
    },
  });

  const attachments: { id: string; fileName: string; mimeType: string; size: number }[] = [];
  if (hasFile) {
    const uploadForm = new FormData();
    uploadForm.set("file", file as File);
    // L'entityId d'un document MESSAGE est l'id du Message lui-même — voir
    // le cas MESSAGE de assertEntityBelongsToCrm dans documents/actions.ts,
    // qui revérifie déjà que ce message appartient bien à ce CRM.
    const uploadResult = await uploadDocument(tenant.crmId, DocumentEntity.MESSAGE, message.id, uploadForm);
    if (!uploadResult.ok || !uploadResult.documentId) {
      return { ok: false, error: uploadResult.error ?? "Échec de l'envoi de la pièce jointe." };
    }
    await prisma.messageAttachment.create({
      data: { messageId: message.id, documentId: uploadResult.documentId },
    });
    const doc = await prisma.document.findUnique({ where: { id: uploadResult.documentId } });
    if (doc) attachments.push({ id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType, size: doc.size });
  }

  // L'auteur a par définition "lu" son propre message.
  await prisma.messageThreadParticipant.update({
    where: { threadId_userId: { threadId: thread.id, userId: ctx.user.id } },
    data: { lastReadAt: new Date() },
  });

  const participants = await prisma.messageThreadParticipant.findMany({
    where: { threadId: thread.id },
    select: { userId: true },
  });
  const otherIds = participants.map((p) => p.userId).filter((id) => id !== ctx.user.id);

  const author = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { firstName: true, lastName: true, color: true },
  });
  const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim();
  const bodyPreview = body ? (body.length > 140 ? `${body.slice(0, 140)}…` : body) : "Pièce jointe";

  if (otherIds.length > 0) {
    await prisma.notification.createMany({
      data: otherIds.map((userId) => ({
        crmId: tenant.crmId,
        userId,
        actorId: ctx.user.id,
        type: "MESSAGE_RECEIVED" as const,
        title: thread.type === ThreadType.GROUP ? `Nouveau message dans ${thread.name ?? "un groupe"}` : `Nouveau message de ${authorName}`,
        body: bodyPreview,
        entityType: "MESSAGE_THREAD",
        entityId: thread.id,
      })),
    });
  }

  const realtimePayload = { threadId: thread.id, messageId: message.id, authorId: ctx.user.id };
  await publishToCrm(tenant.crmId, "message.created", realtimePayload);
  for (const userId of participants.map((p) => p.userId)) {
    await publishToUser(userId, "message.created", realtimePayload);
  }
  for (const userId of otherIds) {
    await publishToUser(userId, "notification.created", {
      type: "MESSAGE_RECEIVED",
      entityType: "MESSAGE_THREAD",
      entityId: thread.id,
    });
  }

  revalidatePath(`/c/${tenant.crmSlug}/messages`);

  return {
    ok: true,
    message: {
      id: message.id,
      threadId: message.threadId,
      body: message.body,
      createdAt: message.createdAt,
      author: { id: ctx.user.id, firstName: author?.firstName ?? "", lastName: author?.lastName ?? "", color: author?.color ?? "#3b6bf5" },
      attachments,
    },
  };
}
