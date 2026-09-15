import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/server/activity";
import { publishToCrm, publishToUser } from "@/lib/realtime";
import type { AutomationRule, AutomationTrigger } from "@prisma/client";

// ============================================================================
// Moteur d'automatisations — CRM Master
// ============================================================================
//
// Ce module exécute les `AutomationRule` (déclencheur -> actions) définies
// par CRM. Une seule action est actuellement supportée par le schéma :
// `CREATE_TASK`, qui crée une `Task` liée à l'entité qui a déclenché
// l'automatisation.
//
// -----------------------------------------------------------------------
// Forme du JSON `AutomationAction.config` pour `type: "CREATE_TASK"`
// -----------------------------------------------------------------------
// {
//   title: string;                                   // obligatoire
//   description?: string;
//   priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";  // défaut : "NORMAL"
//   assignTo?: "OWNER" | "CREATOR";                   // défaut : "OWNER"
//   dueInDays?: number;                                // délai additionnel, défaut : 0
// }
// `config` est un `Json` Prisma non typé : on le revalide systématiquement
// avec `createTaskConfigSchema` avant de l'utiliser. Une config invalide est
// ignorée (avec un `console.error`) plutôt que de faire échouer tout le
// déclenchement.
//
// -----------------------------------------------------------------------
// Échéance de la tâche créée
// -----------------------------------------------------------------------
// dueAt = maintenant + (rule.delayDays + (config.dueInDays ?? 0)) jours.
// Il n'existe pas d'ordonnanceur en tâche de fond dans ce projet : une règle
// "relance à J+5" ne "attend" donc pas 5 jours pour créer la tâche — la
// tâche est créée immédiatement, avec une échéance (`dueAt`) fixée 5 jours
// plus tard. C'est fonctionnellement équivalent pour un CRM piloté par
// tâches : le commercial voit la relance apparaître dans ses tâches à venir
// avec la bonne date d'échéance.
//
// -----------------------------------------------------------------------
// Résolution de `assigneeId` (à qui la tâche automatique est assignée)
// -----------------------------------------------------------------------
// Ordre de préférence :
//   - config.assignTo === "CREATOR" : `context.ownerId` (l'utilisateur qui a
//     déclenché l'événement métier, ex. l'auteur de l'envoi du devis) en
//     priorité, puis le propriétaire de l'entité liée (client/prospect/RDV)
//     en repli.
//   - config.assignTo === "OWNER" (ou absent, valeur par défaut) : le
//     propriétaire de l'entité liée en priorité, puis `context.ownerId` en
//     repli.
//   - Si aucun des deux candidats n'est un membre actif du CRM : repli sur
//     un manager actif du CRM, puis un membre actif quelconque, puis un
//     administrateur global actif. Si vraiment personne n'est disponible,
//     l'action est ignorée (log d'erreur) plutôt que de planter.
//
// -----------------------------------------------------------------------
// Résolution de `createdById` (obligatoire en base, référence un User réel)
// -----------------------------------------------------------------------
// Il n'existe pas d'acteur "système" dans le schéma. Choix documenté :
//   createdById = propriétaire de l'entité liée (client/prospect/RDV) si
//                 résolvable, sinon `context.ownerId` fourni par l'appelant,
//                 sinon l'assigné final de la tâche (`assigneeId`).
// Ce choix garantit toujours un User valide et reste cohérent avec le sens
// métier : la tâche automatique est "portée" par la personne responsable de
// l'entité qui l'a déclenchée.
//
// -----------------------------------------------------------------------
// Idempotence
// -----------------------------------------------------------------------
// Le modèle `Task` n'a pas de `ruleId`. Pour éviter les doublons (appel en
// double d'un même événement métier, ou balayage périodique répété), on
// considère qu'une tâche automatique "équivalente" existe déjà si, pour ce
// CRM, il existe une `Task` avec `isAutomated: true`, `status != DONE`,
// le même `title` que `config.title`, et liée à la même entité
// (client/prospect/devis/rendez-vous). Dans ce cas, aucune nouvelle tâche
// n'est créée. C'est une convention par construction (le titre de la règle
// sert de clé), pas une contrainte imposée par le schéma — documentée ici
// car un autre module pourrait vouloir l'affiner plus tard (ex. ajouter un
// champ dédié sur `Task`).
//
// -----------------------------------------------------------------------
// Intégration par les autres modules
// -----------------------------------------------------------------------
// Après leur propre mutation (ex. passage d'un devis en statut SENT), les
// autres modules doivent appeler :
//
//   import { runAutomationTrigger } from "@/server/automations/engine";
//
//   await runAutomationTrigger(tenant.crmId, "QUOTE_SENT", {
//     quoteId: quote.id,
//     clientId: quote.clientId,
//     ownerId: ctx.user.id, // l'utilisateur qui a envoyé le devis
//   });
//
// Autres exemples :
//   await runAutomationTrigger(tenant.crmId, "APPOINTMENT_COMPLETED", {
//     appointmentId: appointment.id,
//     clientId: appointment.clientId ?? undefined,
//     prospectId: appointment.prospectId ?? undefined,
//     ownerId: appointment.ownerId,
//   });
//
//   await runAutomationTrigger(tenant.crmId, "PROSPECT_CONVERTED", {
//     prospectId: prospect.id,
//     clientId: newClient.id,
//     ownerId: newClient.ownerId,
//   });
//
//   await runAutomationTrigger(tenant.crmId, "CLIENT_CREATED", {
//     clientId: client.id,
//     ownerId: client.ownerId,
//   });
//
// L'appel est best-effort et ne lève jamais d'exception (toutes les erreurs
// internes sont interceptées et loggées) : un module appelant n'a donc pas
// besoin de wrapper l'appel dans un try/catch pour protéger sa propre
// transaction métier.

export interface AutomationTriggerContext {
  clientId?: string;
  prospectId?: string;
  quoteId?: string;
  appointmentId?: string;
  /** Utilisateur "acteur" de l'événement déclencheur (ex. auteur de l'envoi du devis). */
  ownerId?: string;
}

const createTaskConfigSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignTo: z.enum(["OWNER", "CREATOR"]).optional(),
  dueInDays: z.coerce.number().int().min(0).max(3650).optional(),
});

export type CreateTaskActionConfig = z.infer<typeof createTaskConfigSchema>;

/** Revalide le contenu (non typé) de `AutomationAction.config`. Retourne `null` si invalide. */
export function parseCreateTaskConfig(json: unknown): CreateTaskActionConfig | null {
  const parsed = createTaskConfigSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

interface ResolvedContext {
  clientId?: string;
  prospectId?: string;
  quoteId?: string;
  appointmentId?: string;
  /** Propriétaire (ownerId) de l'entité liée, si résolvable. */
  entityOwnerId: string | null;
  ownerId?: string;
}

/**
 * Recharge chaque référence de `context` depuis la base pour vérifier
 * qu'elle appartient bien à `crmId` (jamais confiance dans les ids fournis
 * par l'appelant) et récupère au passage le propriétaire de l'entité liée
 * quand c'est possible.
 */
async function resolveContext(crmId: string, context: AutomationTriggerContext): Promise<ResolvedContext> {
  let entityOwnerId: string | null = null;
  let clientId: string | undefined;
  let prospectId: string | undefined;
  let quoteId: string | undefined;
  let appointmentId: string | undefined;

  if (context.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: context.clientId },
      select: { crmId: true, ownerId: true },
    });
    if (client && client.crmId === crmId) {
      clientId = context.clientId;
      entityOwnerId = client.ownerId;
    }
  }
  if (context.prospectId) {
    const prospect = await prisma.prospect.findUnique({
      where: { id: context.prospectId },
      select: { crmId: true, ownerId: true },
    });
    if (prospect && prospect.crmId === crmId) {
      prospectId = context.prospectId;
      entityOwnerId = entityOwnerId ?? prospect.ownerId;
    }
  }
  if (context.quoteId) {
    const quote = await prisma.quote.findUnique({ where: { id: context.quoteId }, select: { crmId: true } });
    if (quote && quote.crmId === crmId) quoteId = context.quoteId;
  }
  if (context.appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: context.appointmentId },
      select: { crmId: true, ownerId: true },
    });
    if (appointment && appointment.crmId === crmId) {
      appointmentId = context.appointmentId;
      entityOwnerId = entityOwnerId ?? appointment.ownerId;
    }
  }

  return { clientId, prospectId, quoteId, appointmentId, entityOwnerId, ownerId: context.ownerId };
}

async function isActiveCrmMember(crmId: string, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, isGlobalAdmin: true } });
  if (!user || user.status !== "ACTIVE") return false;
  if (user.isGlobalAdmin) return true;
  const access = await prisma.userCrmAccess.findUnique({ where: { userId_crmId: { userId, crmId } } });
  return Boolean(access);
}

async function resolveFallbackUserId(crmId: string): Promise<string | null> {
  const manager = await prisma.userCrmAccess.findFirst({
    where: { crmId, role: "MANAGER", user: { status: "ACTIVE" } },
    select: { userId: true },
    orderBy: { grantedAt: "asc" },
  });
  if (manager) return manager.userId;

  const anyMember = await prisma.userCrmAccess.findFirst({
    where: { crmId, user: { status: "ACTIVE" } },
    select: { userId: true },
    orderBy: { grantedAt: "asc" },
  });
  if (anyMember) return anyMember.userId;

  const globalAdmin = await prisma.user.findFirst({
    where: { isGlobalAdmin: true, status: "ACTIVE" },
    select: { id: true },
  });
  return globalAdmin?.id ?? null;
}

async function resolveAssigneeId(
  crmId: string,
  assignTo: CreateTaskActionConfig["assignTo"],
  resolved: ResolvedContext
): Promise<string | null> {
  const preferOwner = assignTo !== "CREATOR"; // "OWNER" est la valeur par défaut
  const candidates = preferOwner
    ? [resolved.entityOwnerId, resolved.ownerId]
    : [resolved.ownerId, resolved.entityOwnerId];

  for (const candidate of candidates) {
    if (candidate && (await isActiveCrmMember(crmId, candidate))) return candidate;
  }
  return resolveFallbackUserId(crmId);
}

async function notifyAssignee(crmId: string, userId: string, taskId: string, title: string): Promise<void> {
  try {
    // Notification directe au seul assigné (pas `notifyCrm`) : une tâche
    // automatique est un suivi personnel, pas une annonce à toute l'équipe.
    await prisma.notification.create({
      data: {
        crmId,
        userId,
        type: "TASK_CREATED",
        title: `Nouvelle tâche automatique : ${title}`,
        entityType: "TASK",
        entityId: taskId,
      },
    });
    await publishToUser(userId, "notification.created", { type: "TASK_CREATED", title });
  } catch (err) {
    console.error("[automations] échec de notification de l'assigné", err);
  }
}

/**
 * Crée la tâche pour une action `CREATE_TASK`, avec dédoublonnage (voir
 * section "Idempotence" en tête de fichier). Retourne la tâche créée, ou
 * `null` si elle a été ignorée (doublon détecté ou aucun assigné résolvable).
 */
async function createAutomatedTask(
  crmId: string,
  rule: Pick<AutomationRule, "id" | "name" | "trigger" | "delayDays">,
  config: CreateTaskActionConfig,
  resolved: ResolvedContext
) {
  const existing = await prisma.task.findFirst({
    where: {
      crmId,
      isAutomated: true,
      status: { not: "DONE" },
      title: config.title,
      ...(resolved.clientId ? { clientId: resolved.clientId } : {}),
      ...(resolved.prospectId ? { prospectId: resolved.prospectId } : {}),
      ...(resolved.quoteId ? { quoteId: resolved.quoteId } : {}),
      ...(resolved.appointmentId ? { appointmentId: resolved.appointmentId } : {}),
    },
    select: { id: true },
  });
  if (existing) return null;

  const assigneeId = await resolveAssigneeId(crmId, config.assignTo, resolved);
  if (!assigneeId) {
    console.error(`[automations] aucun responsable résolvable pour la règle "${rule.name}" (crm ${crmId})`);
    return null;
  }
  const createdById = resolved.entityOwnerId ?? resolved.ownerId ?? assigneeId;

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + rule.delayDays + (config.dueInDays ?? 0));

  const task = await prisma.task.create({
    data: {
      crmId,
      title: config.title,
      description: config.description ?? null,
      assigneeId,
      clientId: resolved.clientId ?? null,
      prospectId: resolved.prospectId ?? null,
      quoteId: resolved.quoteId ?? null,
      appointmentId: resolved.appointmentId ?? null,
      priority: config.priority ?? "NORMAL",
      status: "TODO",
      dueAt,
      createdById,
      isAutomated: true,
    },
  });

  await logActivity({
    crmId,
    userId: createdById,
    action: "automation.task_created",
    entityType: "TASK",
    entityId: task.id,
    clientId: resolved.clientId,
    prospectId: resolved.prospectId,
    quoteId: resolved.quoteId,
    appointmentId: resolved.appointmentId,
    newValue: { ruleId: rule.id, ruleName: rule.name, trigger: rule.trigger, title: task.title },
  });
  await publishToCrm(crmId, "task.upserted", { id: task.id });
  await notifyAssignee(crmId, assigneeId, task.id, task.title);

  return task;
}

/**
 * Exécute toutes les règles d'automatisation actives d'un CRM pour un
 * déclencheur donné et crée les tâches correspondantes.
 *
 * Signature : `runAutomationTrigger(crmId: string, trigger: AutomationTrigger, context?: AutomationTriggerContext): Promise<void>`
 *
 * Exemple :
 * ```ts
 * import { runAutomationTrigger } from "@/server/automations/engine";
 *
 * await runAutomationTrigger(tenant.crmId, "QUOTE_SENT", {
 *   quoteId: quote.id,
 *   clientId: quote.clientId,
 *   ownerId: ctx.user.id,
 * });
 * ```
 *
 * Ne lève jamais d'exception : toute erreur interne est loggée et
 * n'interrompt pas la transaction métier de l'appelant. Sûr à appeler même
 * si aucune règle n'est configurée pour ce CRM/déclencheur (no-op).
 */
export async function runAutomationTrigger(
  crmId: string,
  trigger: AutomationTrigger,
  context: AutomationTriggerContext = {}
): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { crmId, trigger, isActive: true },
      include: { actions: true },
    });
    if (rules.length === 0) return;

    const resolved = await resolveContext(crmId, context);

    for (const rule of rules) {
      for (const action of rule.actions) {
        if (action.type !== "CREATE_TASK") continue;
        const config = parseCreateTaskConfig(action.config);
        if (!config) {
          console.error(`[automations] config CREATE_TASK invalide pour la règle ${rule.id} (${rule.name})`);
          continue;
        }
        await createAutomatedTask(crmId, rule, config, resolved);
      }
    }
  } catch (err) {
    console.error("[automations] échec runAutomationTrigger", err);
  }
}

/**
 * Balaie les clients et prospects d'un CRM à la recherche d'une absence
 * d'activité récente (`lastContactAt` plus ancien que `rule.delayDays`, ou
 * jamais contacté depuis plus de `rule.delayDays` après leur création) et
 * crée une tâche de relance pour chaque règle `NO_ACTIVITY_SINCE` active.
 * Le dédoublonnage (voir section "Idempotence" en tête de fichier) évite de
 * spammer si le balayage est exécuté plusieurs fois.
 *
 * Appelée par `runNoActivitySweepNow` (action admin) et par la route cron
 * `POST /api/cron/automations`.
 */
export async function runNoActivitySweep(crmId: string): Promise<{ tasksCreated: number }> {
  let tasksCreated = 0;
  try {
    const rules = await prisma.automationRule.findMany({
      where: { crmId, trigger: "NO_ACTIVITY_SINCE", isActive: true },
      include: { actions: true },
    });
    if (rules.length === 0) return { tasksCreated: 0 };

    for (const rule of rules) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - rule.delayDays);

      const [staleClients, staleProspects] = await Promise.all([
        prisma.client.findMany({
          where: {
            crmId,
            OR: [
              { lastContactAt: { lt: threshold } },
              { AND: [{ lastContactAt: null }, { createdAt: { lt: threshold } }] },
            ],
          },
          select: { id: true, ownerId: true },
        }),
        prisma.prospect.findMany({
          where: {
            crmId,
            status: { notIn: ["CONVERTED", "LOST"] },
            OR: [
              { lastContactAt: { lt: threshold } },
              { AND: [{ lastContactAt: null }, { createdAt: { lt: threshold } }] },
            ],
          },
          select: { id: true, ownerId: true },
        }),
      ]);

      for (const action of rule.actions) {
        if (action.type !== "CREATE_TASK") continue;
        const config = parseCreateTaskConfig(action.config);
        if (!config) {
          console.error(`[automations] config CREATE_TASK invalide pour la règle ${rule.id} (${rule.name})`);
          continue;
        }

        for (const client of staleClients) {
          const created = await createAutomatedTask(crmId, rule, config, {
            clientId: client.id,
            entityOwnerId: client.ownerId,
            ownerId: client.ownerId,
          });
          if (created) tasksCreated += 1;
        }
        for (const prospect of staleProspects) {
          const created = await createAutomatedTask(crmId, rule, config, {
            prospectId: prospect.id,
            entityOwnerId: prospect.ownerId,
            ownerId: prospect.ownerId,
          });
          if (created) tasksCreated += 1;
        }
      }
    }
  } catch (err) {
    console.error("[automations] échec runNoActivitySweep", err);
  }
  return { tasksCreated };
}
