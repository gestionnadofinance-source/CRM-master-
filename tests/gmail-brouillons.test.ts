/**
 * Liaison d'un compte Gmail et brouillon de bienvenue des nouveaux
 * utilisateurs, de bout en bout, contre un FAUX serveur Google.
 *
 * Le parcours d'autorisation réel n'est pas rejouable automatiquement : les
 * adresses Google sont lues dans des variables d'environnement, pointées ici
 * vers un serveur local qui joue l'autorisation, les jetons, le profil, les
 * brouillons et la révocation. Il conserve le message déposé, pour relire ce
 * que l'utilisateur recevra, et journalise tout appel inattendu : c'est la
 * seule façon de vérifier côté réseau qu'aucun chemin n'ENVOIE.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import type { AuthContext } from "@/server/auth/session";

const etat = vi.hoisted(() => ({
  ctx: null as unknown as AuthContext | null,
  smtp: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getAuthContext: async () => etat.ctx,
  requireAuth: async () => etat.ctx,
}));
vi.mock("@/lib/email", () => ({
  baseEmailLayout: (_t: string, body: string) => body,
  sendEmail: async (input: { to: string }) => {
    etat.smtp.push(input.to);
    return { delivered: true };
  },
}));

// --- Faux serveur Google -----------------------------------------------------
const google = {
  sansJeton: false,
  panneBrouillons: false,
  brouillons: [] as string[],
  revocations: [] as string[],
  inattendus: [] as string[],
  jetonsEchanges: [] as URLSearchParams[],
};
let server: Server;
let base = "";

function lireCorps(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const corps = await lireCorps(req);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/auth") {
      const retour = new URL(url.searchParams.get("redirect_uri")!);
      retour.searchParams.set("code", "CODE-TEST");
      retour.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { Location: retour.toString() });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/token") {
      const p = new URLSearchParams(corps);
      google.jetonsEchanges.push(p);
      if (p.get("grant_type") === "authorization_code") {
        return json(200, {
          access_token: "ACCES-1",
          ...(google.sansJeton ? {} : { refresh_token: "RAFRAICHISSEMENT-SECRET" }),
          scope: "https://www.googleapis.com/auth/gmail.compose",
        });
      }
      if (p.get("grant_type") === "refresh_token" && p.get("refresh_token") === "RAFRAICHISSEMENT-SECRET") {
        return json(200, { access_token: "ACCES-2" });
      }
      return json(400, { error: "invalid_grant" });
    }
    if (req.method === "GET" && url.pathname === "/profile") {
      return json(200, { emailAddress: "admin.test@gmail.com" });
    }
    if (req.method === "POST" && url.pathname === "/drafts") {
      if (google.panneBrouillons) return json(500, { error: { message: "Erreur interne simulée" } });
      if (req.headers.authorization !== "Bearer ACCES-2") return json(401, { error: { message: "jeton" } });
      google.brouillons.push(corps);
      return json(200, { id: `r${google.brouillons.length}`, message: { id: `m${google.brouillons.length}` } });
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      google.revocations.push(new URLSearchParams(corps).get("token") ?? "");
      return json(200, {});
    }
    google.inattendus.push(`${req.method} ${url.pathname}`);
    return json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "client-test",
    GOOGLE_CLIENT_SECRET: "secret-test",
    GOOGLE_AUTH_URL: `${base}/auth`,
    GOOGLE_TOKEN_URL: `${base}/token`,
    GOOGLE_REVOKE_URL: `${base}/revoke`,
    GMAIL_PROFILE_URL: `${base}/profile`,
    GMAIL_DRAFT_URL: `${base}/drafts`,
    APP_URL: "https://crm.exemple.fr",
  });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.user.deleteMany({ where: { email: { startsWith: "__test__gm_" } } });
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_AUTH_URL", "GOOGLE_TOKEN_URL", "GOOGLE_REVOKE_URL", "GMAIL_PROFILE_URL", "GMAIL_DRAFT_URL", "APP_URL"]) {
    delete process.env[k];
  }
});

const { GET: depart } = await import("@/app/api/google/connexion/route");
const { GET: retour } = await import("@/app/api/google/retour/route");
const { createUser, unlinkGmailAccount, regenerateUserPassword } = await import("@/server/admin/actions");

let adminCtx: AuthContext;
let adminId = "";

function contexte(u: { id: string; firstName: string; lastName: string; email: string; isGlobalAdmin: boolean }): AuthContext {
  return {
    sessionId: "x",
    user: { ...u, status: "ACTIVE", color: "#3b6bf5", avatarUrl: null, theme: "SYSTEM", mustChangePassword: false },
  } as unknown as AuthContext;
}

/** Joue le parcours complet : départ → écran Google (faux) → retour. Rend l'URL finale. */
async function relier(etatForge?: string): Promise<URL> {
  const res1 = await depart(new NextRequest("https://crm.exemple.fr/api/google/connexion"));
  const versGoogle = res1.headers.get("location")!;
  const state = res1.cookies.get("gmail_oauth_state")?.value ?? "";
  const res2 = await fetch(versGoogle, { redirect: "manual" });
  const versRetour = res2.headers.get("location")!;
  const res3 = await retour(
    new NextRequest(versRetour, { headers: { cookie: `gmail_oauth_state=${etatForge ?? state}` } })
  );
  return new URL(res3.headers.get("location")!);
}

function nouvelUtilisateur(email: string): FormData {
  const fd = new FormData();
  fd.set("firstName", "Élodie");
  fd.set("lastName", "Test");
  fd.set("email", email);
  fd.set("color", "#3b6bf5");
  return fd;
}

/** Parties texte et HTML d'un message RFC 5322 en base64. */
function partiesDecodees(raw: string): string {
  return Array.from(raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g), (m) =>
    Buffer.from(m[1]!.replace(/\r\n/g, ""), "base64").toString("utf8")
  ).join("\n");
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: "__test__gm_admin@example.invalid", firstName: "Test", lastName: "Admin",
      passwordHash: await hashPassword("Test1234!"), isGlobalAdmin: true, mustChangePassword: false,
    },
  });
  adminId = admin.id;
  adminCtx = contexte(admin);
});

beforeEach(() => {
  etat.ctx = adminCtx;
  google.sansJeton = false;
  google.panneBrouillons = false;
});

describe("liaison du compte Gmail", () => {
  it("le départ ne demande QUE gmail.compose, avec accès durable, et pose un état anti-falsification", async () => {
    const res = await depart(new NextRequest("https://crm.exemple.fr/api/google/connexion"));
    const url = new URL(res.headers.get("location")!);
    expect(`${url.origin}${url.pathname}`).toBe(`${base}/auth`);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.compose");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.exemple.fr/api/google/retour");
    const cookie = res.cookies.get("gmail_oauth_state");
    expect(cookie?.value).toBe(url.searchParams.get("state"));
    expect(cookie?.httpOnly).toBe(true);
  });

  it("l'adresse de retour affichée à l'administrateur est exactement celle envoyée à Google", async () => {
    const { publicOrigin, redirectUriFor } = await import("@/server/google/gmail");
    // Derrière l'hébergeur : le domaine public arrive dans les en-têtes x-forwarded-*.
    const entetes = { host: "interne:3000", "x-forwarded-host": "crm.exemple.fr", "x-forwarded-proto": "https" };
    const res = await depart(new NextRequest("http://interne:3000/api/google/connexion", { headers: entetes }));
    const envoyee = new URL(res.headers.get("location")!).searchParams.get("redirect_uri");
    const affichee = redirectUriFor(publicOrigin(new Headers(entetes), "http://localhost:3000"));
    expect(envoyee).toBe("https://crm.exemple.fr/api/google/retour");
    expect(affichee).toBe(envoyee);
  });

  it("refuse un retour dont l'état ne correspond pas, sans rien enregistrer", async () => {
    const fin = await relier("etat-forge-par-un-tiers");
    expect(fin.searchParams.get("gmail")).toBe("etat_invalide");
    expect(await prisma.googleMailAccount.count({ where: { userId: adminId } })).toBe(0);
  });

  it("sans jeton de rafraîchissement, n'enregistre rien et l'explique", async () => {
    google.sansJeton = true;
    const fin = await relier();
    expect(fin.searchParams.get("gmail")).toBe("sans_jeton");
    expect(await prisma.googleMailAccount.count({ where: { userId: adminId } })).toBe(0);
  });

  it("relie le compte : adresse retenue, jeton chiffré et jamais en clair", async () => {
    const fin = await relier();
    expect(fin.pathname).toBe("/admin/users");
    expect(fin.searchParams.get("gmail")).toBe("ok");
    const compte = await prisma.googleMailAccount.findUniqueOrThrow({ where: { userId: adminId } });
    expect(compte.email).toBe("admin.test@gmail.com");
    expect(compte.refreshTokenEncrypted).not.toContain("RAFRAICHISSEMENT");
    expect(compte.refreshTokenEncrypted.split(".")).toHaveLength(3);
  });

  it("un non-administrateur ne peut pas lancer la liaison", async () => {
    etat.ctx = contexte({ id: "x", firstName: "A", lastName: "B", email: "a@b.c", isGlobalAdmin: false });
    const res = await depart(new NextRequest("https://crm.exemple.fr/api/google/connexion"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("création d'un utilisateur avec un compte Gmail relié", () => {
  it("dépose un brouillon de bienvenue complet, sans rien envoyer", async () => {
    const avant = google.brouillons.length;
    const res = await createUser(nouvelUtilisateur("__test__gm_nouveau@example.invalid"));
    expect(res.ok).toBe(true);
    expect(res.gmailDraft).toEqual({
      ok: true,
      openUrl: `https://mail.google.com/mail/u/admin.test%40gmail.com/#drafts?compose=m${avant + 1}`,
    });
    // Aucun envoi SMTP en parallèle : l'utilisateur recevrait ses accès deux fois.
    expect(etat.smtp).toEqual([]);

    const raw = google.brouillons.at(-1)!;
    expect(raw).toContain("From: admin.test@gmail.com");
    expect(raw).toContain("To: __test__gm_nouveau@example.invalid");
    expect(raw).toContain("X-Unsent: 1");
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);

    const contenu = partiesDecodees(raw);
    expect(contenu).toContain("Bonjour Élodie");
    expect(contenu).toContain("https://crm.exemple.fr/login?email=__test__gm_nouveau%40example.invalid");
    expect(contenu).toContain(res.temporaryPassword!);
    expect(contenu).not.toMatch(/undefined|\$\{/);

    const compte = await prisma.googleMailAccount.findUniqueOrThrow({ where: { userId: adminId } });
    expect(compte.lastError).toBeNull();
    expect(compte.lastUsedAt).not.toBeNull();
  });

  it("régénérer le mot de passe prépare aussi un brouillon, avec le NOUVEAU mot de passe", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "__test__gm_nouveau@example.invalid" } });
    const avant = google.brouillons.length;
    const res = await regenerateUserPassword(u.id);
    expect(res.ok).toBe(true);
    expect(res.gmailDraft).toEqual({
      ok: true,
      openUrl: `https://mail.google.com/mail/u/admin.test%40gmail.com/#drafts?compose=m${avant + 1}`,
    });
    expect(etat.smtp).toEqual([]);

    const raw = google.brouillons.at(-1)!;
    expect(raw).toContain("To: __test__gm_nouveau@example.invalid");
    expect(raw).toContain("X-Unsent: 1");
    const sujet = Buffer.from(/Subject: =\?UTF-8\?B\?(.*?)\?=/.exec(raw)![1]!, "base64").toString("utf8");
    expect(sujet).toBe("CRM Master — votre nouveau mot de passe provisoire");
    const contenu = partiesDecodees(raw);
    expect(contenu).toContain("réinitialisé par un administrateur");
    expect(contenu).toContain(res.temporaryPassword!);
    expect(contenu).toContain("https://crm.exemple.fr/login?email=__test__gm_nouveau%40example.invalid");
  });

  it("une panne Google n'empêche pas la création : l'échec est rendu et retenu sur le compte", async () => {
    google.panneBrouillons = true;
    const res = await createUser(nouvelUtilisateur("__test__gm_panne@example.invalid"));
    expect(res.ok).toBe(true);
    expect(res.temporaryPassword).toBeTruthy();
    expect(res.gmailDraft).toEqual({ ok: false, error: "Dépôt du brouillon : Google a répondu 500 (Erreur interne simulée)." });
    const compte = await prisma.googleMailAccount.findUniqueOrThrow({ where: { userId: adminId } });
    expect(compte.lastError).toBe("Dépôt du brouillon : Google a répondu 500 (Erreur interne simulée).");
  });

  it("secret client changé : le jeton illisible demande de relier à nouveau", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "autre-secret";
    try {
      const res = await createUser(nouvelUtilisateur("__test__gm_secret@example.invalid"));
      expect(res.gmailDraft).toEqual({ ok: false, error: "Le compte Gmail doit être relié de nouveau (accès illisible)." });
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = "secret-test";
    }
  });
});

describe("déliaison et garde-fous", () => {
  it("délier retire l'accès chez Google et efface le jeton ; la création repasse par le SMTP", async () => {
    expect((await unlinkGmailAccount()).ok).toBe(true);
    expect(google.revocations).toEqual(["RAFRAICHISSEMENT-SECRET"]);
    expect(await prisma.googleMailAccount.count({ where: { userId: adminId } })).toBe(0);

    const res = await createUser(nouvelUtilisateur("__test__gm_smtp@example.invalid"));
    expect(res.gmailDraft).toBeUndefined();
    expect(etat.smtp).toEqual(["__test__gm_smtp@example.invalid"]);

    // Régénération sans compte relié : comme avant, rien n'est envoyé.
    const avant = google.brouillons.length;
    const regen = await regenerateUserPassword(res.userId!);
    expect(regen.ok).toBe(true);
    expect(regen.gmailDraft).toBeUndefined();
    expect(google.brouillons.length).toBe(avant);
    expect(etat.smtp).toEqual(["__test__gm_smtp@example.invalid"]);
  });

  it("aucun appel inattendu chez Google — en particulier aucun envoi", () => {
    expect(google.inattendus).toEqual([]);
  });
});
