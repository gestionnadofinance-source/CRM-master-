import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Compte Gmail relié par un administrateur, pour PRÉPARER des brouillons.
 *
 * Ce module DÉPOSE un brouillon dans la boîte de l'administrateur ; il
 * n'envoie jamais rien. Aucune fonction d'envoi n'existe ici, et la seule
 * permission demandée à Google (gmail.compose) ne permet ni de lire la boîte
 * de réception ni de savoir si un brouillon a été envoyé : l'administrateur
 * relit le message dans Gmail et l'envoie lui-même.
 *
 * Les adresses des services Google sont lues à chaque appel, depuis des
 * variables d'environnement qui ont les vraies adresses pour défaut : les
 * tests les pointent vers un faux serveur Google.
 */

/** La seule permission demandée : créer des brouillons. Ni lecture, ni envoi. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Cookie portant le `state` OAuth entre le départ vers Google et le retour. */
export const OAUTH_STATE_COOKIE = "gmail_oauth_state";

const TIMEOUT_MS = 10_000;

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function endpoints() {
  return {
    auth: env("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    token: env("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    revoke: env("GOOGLE_REVOKE_URL", "https://oauth2.googleapis.com/revoke"),
    profile: env("GMAIL_PROFILE_URL", "https://gmail.googleapis.com/gmail/v1/users/me/profile"),
    draft: env("GMAIL_DRAFT_URL", "https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=media"),
  };
}

/** Identifiants OAuth de l'application, ou null tant qu'ils ne sont pas configurés. */
export function googleClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// --- Chiffrement du jeton de rafraîchissement --------------------------------
// AES-256-GCM, clé dérivée du secret client Google : sans ce secret, un jeton
// volé ne sert à rien de toute façon (il faut les deux pour obtenir un accès),
// et aucune variable d'environnement de plus n'est à gérer.

function key(clientSecret: string): Buffer {
  return createHash("sha256").update(clientSecret).digest();
}

export function encryptRefreshToken(token: string, clientSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(clientSecret), iv);
  const payload = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), payload].map((b) => b.toString("base64")).join(".");
}

/** null si le jeton ne se déchiffre plus (secret client changé) : il faut relier à nouveau. */
export function decryptRefreshToken(stored: string, clientSecret: string): string | null {
  try {
    const [iv, tag, payload] = stored.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !payload) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(clientSecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// --- Appels Google -----------------------------------------------------------

class GoogleError extends Error {}

async function call(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new GoogleError(`Google n'a pas répondu en ${TIMEOUT_MS / 1000} s.`);
    throw new GoogleError(`Google est injoignable (${err instanceof Error ? err.message : "erreur réseau"}).`);
  } finally {
    clearTimeout(timer);
  }
}

/** Message lisible à partir d'une réponse d'erreur Google. */
async function describeFailure(res: Response, what: string): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; error_description?: string };
    detail = typeof body.error === "string" ? (body.error_description ?? body.error) : (body.error?.message ?? "");
  } catch {
    // corps illisible : le code HTTP suffira
  }
  if (res.status === 401 || detail === "invalid_grant" || /invalid_grant/.test(detail)) {
    return `${what} : l'accès au compte Gmail a été retiré ou a expiré. Reliez de nouveau le compte.`;
  }
  if (res.status === 429) return `${what} : quota Google dépassé, réessayez plus tard.`;
  return `${what} : Google a répondu ${res.status}${detail ? ` (${detail})` : ""}.`;
}

export function buildAuthorizationUrl(state: string, redirectUri: string, clientId: string): string {
  const url = new URL(endpoints().auth);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("state", state);
  // Sans ces deux paramètres, Google ne rend pas de jeton de rafraîchissement
  // au second passage, et la liaison expire au bout d'une heure.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  cfg: { clientId: string; clientSecret: string }
): Promise<{ accessToken: string; refreshToken: string | null; scope: string }> {
  const res = await call(endpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GoogleError(await describeFailure(res, "Échange du code d'autorisation"));
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!body.access_token) throw new GoogleError("Google n'a pas fourni de jeton d'accès.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, scope: body.scope ?? GMAIL_SCOPE };
}

async function accessTokenFrom(refreshToken: string, cfg: { clientId: string; clientSecret: string }): Promise<string> {
  const res = await call(endpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new GoogleError(await describeFailure(res, "Renouvellement de l'accès Gmail"));
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new GoogleError("Google n'a pas fourni de jeton d'accès.");
  return body.access_token;
}

export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const res = await call(endpoints().profile, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GoogleError(await describeFailure(res, "Lecture de l'adresse du compte"));
  const body = (await res.json()) as { emailAddress?: string };
  if (!body.emailAddress) throw new GoogleError("Google n'a pas fourni l'adresse du compte.");
  return body.emailAddress;
}

/** Retire l'autorisation chez Google. Au mieux : la liaison locale est supprimée quoi qu'il arrive. */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await call(endpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Construction du message --------------------------------------------------

export interface DraftMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(content: string): string {
  return (Buffer.from(content, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Une adresse ne doit porter ni retour à la ligne ni chevron : elle irait injecter des en-têtes. */
function safeAddress(value: string): string {
  if (/[\r\n<>,;]/.test(value)) throw new GoogleError("Adresse e-mail invalide pour le brouillon.");
  return value;
}

/** Message RFC 5322 brut, texte + HTML. */
export function buildRawMessage(m: DraftMessage): string {
  const boundary = `crm_${randomBytes(12).toString("hex")}`;
  return [
    `From: ${safeAddress(m.from)}`,
    `To: ${safeAddress(m.to)}`,
    `Subject: ${encodeHeader(m.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    // Présente le message comme un brouillon à envoyer, pas comme un courrier reçu.
    "X-Unsent: 1",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(m.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// --- Préparer un brouillon pour un administrateur -----------------------------

export type DraftResult = { ok: true; openUrl: string } | { ok: false; error: string };

/**
 * Dépose `message` en brouillon dans le Gmail relié par `adminUserId`.
 * Ne lève jamais : un échec est rendu, et enregistré sur le compte pour être
 * montré dans l'administration.
 */
export async function prepareDraft(adminUserId: string, message: Omit<DraftMessage, "from">): Promise<DraftResult> {
  const account = await prisma.googleMailAccount.findUnique({ where: { userId: adminUserId } });
  if (!account) return { ok: false, error: "Aucun compte Gmail n'est relié." };

  const fail = async (error: string): Promise<DraftResult> => {
    await prisma.googleMailAccount.update({ where: { id: account.id }, data: { lastError: error } });
    return { ok: false, error };
  };

  const cfg = googleClientConfig();
  if (!cfg) return fail("La connexion Google n'est pas configurée sur le serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const refreshToken = decryptRefreshToken(account.refreshTokenEncrypted, cfg.clientSecret);
  if (!refreshToken) return fail("Le compte Gmail doit être relié de nouveau (accès illisible).");

  try {
    const accessToken = await accessTokenFrom(refreshToken, cfg);
    const res = await call(endpoints().draft, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" },
      body: buildRawMessage({ ...message, from: account.email }),
    });
    if (!res.ok) return fail(await describeFailure(res, "Dépôt du brouillon"));
    const body = (await res.json()) as { id?: string; message?: { id?: string } };
    const messageId = body.message?.id;
    if (!messageId) return fail("Google n'a pas fourni l'identifiant du brouillon.");

    await prisma.googleMailAccount.update({
      where: { id: account.id },
      data: { lastUsedAt: new Date(), lastError: null },
    });
    // L'identifiant du MESSAGE, pas celui du brouillon : c'est lui que Gmail
    // attend pour ouvrir le brouillon en édition. L'adresse dans le chemin
    // ouvre le bon compte quand plusieurs sont connectés dans le navigateur.
    return {
      ok: true,
      openUrl: `https://mail.google.com/mail/u/${encodeURIComponent(account.email)}/#drafts?compose=${encodeURIComponent(messageId)}`,
    };
  } catch (err) {
    return fail(err instanceof GoogleError ? err.message : "Erreur inattendue lors du dépôt du brouillon.");
  }
}

/**
 * Adresse de retour déclarée chez Google. Elle doit être IDENTIQUE à celle
 * enregistrée dans la console Google Cloud : GOOGLE_REDIRECT_URI la fixe
 * quand le site est servi derrière plusieurs domaines ; sinon, celle du
 * domaine par lequel l'administrateur est passé.
 */
export function redirectUriFor(origin: string): string {
  return env("GOOGLE_REDIRECT_URI", `${origin}/api/google/retour`);
}
