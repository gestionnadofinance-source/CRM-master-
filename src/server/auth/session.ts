import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/crypto";
import { getServerEnv } from "@/lib/env";
import type { User } from "@prisma/client";

const MAX_ACTIVE_SESSIONS_PER_USER = 10;

export type SessionUser = Pick<
  User,
  | "id"
  | "firstName"
  | "lastName"
  | "email"
  | "isGlobalAdmin"
  | "status"
  | "color"
  | "avatarUrl"
  | "theme"
  | "mustChangePassword"
>;

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
}

/** Crée une session persistée en base et pose le cookie httpOnly. */
export async function createSession(userId: string): Promise<string> {
  const env = getServerEnv();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent") ?? undefined;
  const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

  const activeSessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (activeSessions.length >= MAX_ACTIVE_SESSIONS_PER_USER) {
    const toRevoke = activeSessions.slice(0, activeSessions.length - MAX_ACTIVE_SESSIONS_PER_USER + 1);
    await prisma.session.updateMany({
      where: { id: { in: toRevoke.map((s) => s.id) } },
      data: { revokedAt: new Date() },
    });
  }

  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, userAgent, ipAddress },
  });

  const cookieStore = await cookies();
  cookieStore.set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/** Lit la session courante depuis le cookie et vérifie sa validité en base. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }
  if (session.user.status !== "ACTIVE") {
    return null;
  }

  // Rafraîchit lastSeenAt au plus une fois par minute pour éviter le
  // matraquage d'écritures en base sur chaque requête.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    await prisma.user.update({
      where: { id: session.user.id },
      data: { presence: "ONLINE", lastActiveAt: new Date() },
    });
  }

  const { user } = session;
  return {
    sessionId: session.id,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      isGlobalAdmin: user.isGlobalAdmin,
      status: user.status,
      color: user.color,
      avatarUrl: user.avatarUrl,
      theme: user.theme,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

/** Exige une session valide ; à utiliser en tête des Server Actions / routes API. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new AuthError("UNAUTHENTICATED", "Session expirée ou invalide.");
  }
  return ctx;
}

/**
 * Comme requireAuth, mais (a) renvoie proprement vers /login au lieu de
 * lever une exception non interceptée quand la session est absente,
 * expirée ou révoquée — cas courant : un administrateur vient de
 * régénérer le mot de passe de l'utilisateur (voir
 * src/server/admin/actions.ts), ce qui révoque ses sessions actives
 * pendant qu'il navigue encore — et (b) renvoie vers /first-login tant
 * que le mot de passe temporaire n'a pas été remplacé. À utiliser dans
 * les pages (layouts) plutôt que requireAuth dès qu'on veut bloquer
 * l'accès au reste de l'application.
 *
 * Ne tente PAS de supprimer le cookie périmé : un Server Component ne
 * peut pas muter les cookies (seule une Server Action/Route Handler le
 * peut — voir la doc Next.js). Le cookie reste donc présent mais
 * invalide jusqu'à la prochaine connexion réussie, qui le remplace ; ce
 * n'est jamais un problème car /login revalide lui-même en base plutôt
 * que de faire confiance à la simple présence du cookie (voir
 * src/app/login/page.tsx et src/middleware.ts).
 */
export async function requireActiveAuth(): Promise<AuthContext> {
  let ctx: AuthContext;
  try {
    ctx = await requireAuth();
  } catch (err) {
    if (err instanceof AuthError && err.code === "UNAUTHENTICATED") {
      redirect("/login");
    }
    throw err;
  }
  if (ctx.user.mustChangePassword) {
    redirect("/first-login");
  }
  return ctx;
}

/**
 * Variante de requireAuth pour les pages qui ne peuvent pas utiliser
 * requireActiveAuth (ex. /first-login lui-même, qui bouclerait sur sa
 * propre redirection tant que mustChangePassword est vrai) mais doivent
 * quand même renvoyer proprement vers /login — jamais planter — quand la
 * session est absente, expirée ou révoquée.
 */
export async function requireAuthOrRedirect(): Promise<AuthContext> {
  try {
    return await requireAuth();
  } catch (err) {
    if (err instanceof AuthError && err.code === "UNAUTHENTICATED") {
      redirect("/login");
    }
    throw err;
  }
}

export async function destroyCurrentSession(): Promise<void> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(env.SESSION_COOKIE_NAME);
}

export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, id: { not: keepSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export class AuthError extends Error {
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "CRM_ACCESS_DENIED";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}
