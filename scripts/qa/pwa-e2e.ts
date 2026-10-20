/**
 * Validation de l'application installable (PWA) dans un vrai Chromium,
 * contre un serveur de production local (`next build && next start`).
 *
 * Ce que ce script prouve, et ce qu'il ne peut pas prouver :
 *   - prouvé : ressources publiques et routes privées, critères
 *     d'installabilité de Chromium (CDP), enregistrement du service worker,
 *     contenu réel du cache après navigation authentifiée, comportement hors
 *     ligne, bouton « Télécharger l'application » (invite native simulée,
 *     instructions iOS, mode installé), connexion / déconnexion, affichage
 *     mobile sans défilement horizontal ;
 *   - non prouvé : l'installation réelle sur Windows, macOS, Android, iPhone
 *     ou iPad — elle demande un vrai appareil et un geste humain.
 *
 * Usage : npx tsx scripts/qa/pwa-e2e.ts <jeton de session admin> <dossier de captures> [phase]
 *   phase = "complet" (défaut) | "mise-a-jour-1" | "mise-a-jour-2"
 */
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdirSync } from "fs";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:3100";
const SLUG = "fidem-froid-clim";
const PROFIL = "/tmp/claude-0/-home-user-CRM-master-/0011be00-d81a-5e4f-ad9f-bbe0f613ada3/scratchpad/pwa-profil";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type Resultat = { point: string; ok: boolean; detail?: string };
const resultats: Resultat[] = [];
function verifier(point: string, ok: boolean, detail?: unknown) {
  resultats.push({ point, ok, detail: detail === undefined ? undefined : String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) });
}

async function cookie(ctx: BrowserContext, token: string) {
  await ctx.addCookies([{ name: "crm_master_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

/** Simule l'invite native de Chrome (beforeinstallprompt), avec le choix donné. */
async function simulerInvite(page: Page, choix: "accepted" | "dismissed") {
  await page.evaluate((outcome) => {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    (window as unknown as { __promptAppele: number }).__promptAppele = 0;
    e.prompt = async () => {
      (window as unknown as { __promptAppele: number }).__promptAppele++;
    };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, choix);
}

async function ouvrirMenuCompte(page: Page) {
  await page.locator("header button[title]").last().click();
}

/** Une entrée du menu du compte (le bandeau porte un bouton de même nom). */
function menu(page: Page, nom: string) {
  return page.locator("header .w-56").getByRole("button", { name: nom, exact: true });
}

async function publiques() {
  const sans = async (p: string) => fetch(`${BASE}${p}`, { redirect: "manual" });
  const m = await sans("/manifest.webmanifest");
  const corps = m.status === 200 ? await m.json() : null;
  verifier("manifeste lisible sans session", m.status === 200 && corps?.name === "CRM Master", `${m.status} ${m.headers.get("content-type")}`);
  for (const i of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]) {
    const r = await sans(i);
    verifier(`icône ${i}`, r.status === 200 && r.headers.get("content-type") === "image/png", r.status);
  }
  const sw = await sans("/sw.js");
  verifier("service worker sans cache HTTP", sw.status === 200 && /no-store/.test(sw.headers.get("cache-control") ?? ""), sw.headers.get("cache-control"));
  verifier("page hors ligne publique", (await sans("/offline.html")).status === 200);
  for (const p of ["/home", "/admin/users", `/c/${SLUG}/vault`, `/c/${SLUG}/pointage-salaries`]) {
    const r = await sans(p);
    verifier(`route privée ${p} toujours protégée`, r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/login"), `${r.status} ${r.headers.get("location")}`);
  }
}

async function installabilite(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/home`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const controle = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  verifier("service worker actif et contrôlant la page", controle);
  const cdp = await ctx.newCDPSession(page);
  const manifest = (await cdp.send("Page.getAppManifest")) as { errors: unknown[]; url: string };
  verifier("manifeste sans erreur (Chromium)", manifest.errors.length === 0, manifest.errors);
  const install = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: unknown[] };
  verifier("critères d'installation remplis (Chromium)", install.installabilityErrors.length === 0, install.installabilityErrors);
  await page.close();
}

async function cacheApresNavigation(ctx: BrowserContext, dossier: string) {
  const page = await ctx.newPage();
  for (const p of ["/home", "/admin", "/admin/users", `/c/${SLUG}/planning`, `/c/${SLUG}/vault`, `/c/${SLUG}/pointage-salaries`, `/c/${SLUG}/silae`]) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  }
  // Navigation interne (données de page RSC) via la barre latérale.
  const lien = page.locator(`a[href="/c/${SLUG}/planning"]`).first();
  if (await lien.count()) {
    await lien.click();
    await page.waitForLoadState("networkidle");
  }
  const entrees = await page.evaluate(async () => {
    const out: string[] = [];
    for (const nom of await caches.keys()) {
      const c = await caches.open(nom);
      for (const r of await c.keys()) out.push(`${nom} ${new URL(r.url).pathname}`);
    }
    return out;
  });
  const interdites = entrees.filter((e) => !/ (\/_next\/static\/|\/icons\/[a-z0-9-]+\.png$|\/offline\.html$)/.test(e));
  verifier("cache : uniquement fichiers statiques publics", interdites.length === 0 && entrees.length > 0, interdites.length ? interdites : `${entrees.length} fichiers, tous statiques`);

  // Hors ligne.
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  verifier("bandeau « Hors connexion » affiché", await page.getByText("Hors connexion").isVisible());
  await page.screenshot({ path: `${dossier}/hors-ligne-bandeau.png` });
  await page.goto(`${BASE}/c/${SLUG}/vault`).catch(() => undefined);
  const texte = await page.locator("body").innerText();
  verifier("hors ligne : page d'information, aucune page privée en copie", texte.includes("Pas de connexion internet") && !texte.includes("Coffre-fort"), texte.slice(0, 80));
  await page.screenshot({ path: `${dossier}/hors-ligne-page.png` });
  await ctx.setOffline(false);
  await page.close();
}

async function boutonInstallation(ctx: BrowserContext, dossier: string) {
  // Invite native acceptée, puis installation confirmée par le navigateur.
  let page = await ctx.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("crm-pwa-banner-dismissed-at"));
  await simulerInvite(page, "accepted");
  await page.waitForTimeout(200);
  verifier("bandeau de proposition affiché quand l'installation est possible", await page.getByText("Installer CRM Master sur cet appareil").isVisible());
  await page.screenshot({ path: `${dossier}/bandeau-ordinateur.png` });
  await ouvrirMenuCompte(page);
  const item = menu(page, "Télécharger l'application");
  verifier("« Télécharger l'application » dans le menu du compte", await item.isVisible());
  await page.screenshot({ path: `${dossier}/menu-compte.png` });
  await item.click();
  await page.waitForTimeout(200);
  verifier("le clic déclenche l'invite native", (await page.evaluate(() => (window as unknown as { __promptAppele: number }).__promptAppele)) === 1);
  verifier("confirmation affichée après acceptation", await page.getByText("Installation acceptée").isVisible());
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await page.waitForTimeout(200);
  verifier("message « installée » à la confirmation du navigateur", await page.getByText("CRM Master est installée").isVisible());
  await ouvrirMenuCompte(page);
  verifier("menu : « Application installée » ensuite", await menu(page, "Application installée").isVisible());
  await page.close();

  // Invite refusée : message, et le bandeau ne revient pas.
  page = await ctx.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("crm-pwa-banner-dismissed-at");
    localStorage.removeItem("crm-pwa-installed");
  });
  await page.reload({ waitUntil: "networkidle" });
  await simulerInvite(page, "dismissed");
  await page.getByRole("region", { name: "Installer l'application" }).getByRole("button", { name: /Télécharger/ }).click();
  await page.waitForTimeout(200);
  verifier("refus : message clair", await page.getByText("Installation annulée").isVisible());
  await page.reload({ waitUntil: "networkidle" });
  await simulerInvite(page, "dismissed");
  await page.waitForTimeout(200);
  verifier("refus : le bandeau ne se réaffiche pas", !(await page.getByText("Installer CRM Master sur cet appareil").isVisible()));
  await ouvrirMenuCompte(page);
  verifier("refus : le bouton du menu reste disponible", await menu(page, "Télécharger l'application").isVisible());
  await page.close();

  // Sans invite native (ex. Firefox) : aide contextuelle.
  page = await ctx.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await ouvrirMenuCompte(page);
  await menu(page, "Télécharger l'application").click();
  verifier("sans invite native : fenêtre d'aide adaptée (Chrome)", await page.getByText("Installer CRM Master avec Chrome").isVisible());
  await page.screenshot({ path: `${dossier}/aide-chrome.png` });
  await page.close();
}

async function iphoneEtModeInstalle(browserToken: string, dossier: string) {
  const browser = await chromium.launch({ executablePath: CHROME });
  // iPhone / Safari : pas d'invite native, instructions.
  const ios = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await cookie(ios, browserToken);
  const page = await ios.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  verifier("iPhone : bandeau proposé", await page.getByText("Installer CRM Master sur cet appareil").isVisible());
  await page.screenshot({ path: `${dossier}/iphone-bandeau.png` });
  await page.getByRole("region", { name: "Installer l'application" }).getByRole("button", { name: /Télécharger/ }).click();
  const aide = await page.locator("body").innerText();
  verifier("iPhone : instructions Safari (partage → Sur l'écran d'accueil)", aide.includes("Sur l'écran d'accueil") && aide.includes("ne permet pas à un site de lancer lui-même"));
  await page.screenshot({ path: `${dossier}/iphone-instructions.png` });
  await ios.close();

  // Application ouverte en mode installé (standalone).
  const app = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await cookie(app, browserToken);
  await app.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes("display-mode: standalone") ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : orig(q);
  });
  const p2 = await app.newPage();
  await p2.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  verifier("mode installé : aucun bandeau", !(await p2.getByText("Installer CRM Master sur cet appareil").isVisible()));
  await ouvrirMenuCompte(p2);
  verifier("mode installé : « Application installée »", await p2.locator("header .w-56").getByText("Application installée").isVisible());
  await app.close();
  await browser.close();
}

async function connexionDeconnexion(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await ctx.clearCookies();
  await page.goto(`${BASE}/home`);
  verifier("sans session : renvoi vers la connexion", page.url().includes("/login"));
  await page.fill("#email", "admin@crm-master.local");
  await page.fill("#password", "ChangeMoi123!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/home/, { timeout: 20000 }).catch(() => undefined);
  verifier("connexion depuis l'application", page.url().includes("/home"), page.url());
  await ouvrirMenuCompte(page);
  await menu(page, "Déconnexion").click();
  await page.waitForURL(/\/login/, { timeout: 20000 }).catch(() => undefined);
  await page.goto(`${BASE}/admin/users`);
  verifier("après déconnexion : aucune page privée servie (ni cache)", page.url().includes("/login"), page.url());
  await page.close();
}

async function mobile(browserToken: string, dossier: string) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await cookie(ctx, browserToken);
  await ctx.addInitScript(() => localStorage.setItem("crm-pwa-banner-dismissed-at", String(Date.now())));
  const page = await ctx.newPage();
  const debordements: string[] = [];
  for (const p of [
    "/home", "/settings", "/admin", "/admin/users", "/admin/planning", "/admin/vault", "/admin/silae", "/admin/comptabilite", "/admin/activity", "/admin/api-keys",
    `/c/${SLUG}/planning`, `/c/${SLUG}/pointage-salaries`, `/c/${SLUG}/pointage-client`, `/c/${SLUG}/vault`, `/c/${SLUG}/silae`, `/c/${SLUG}/comptabilite`,
    `/c/${SLUG}/users`, `/c/${SLUG}/activity`, `/c/${SLUG}/settings`,
  ]) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
    const nom = p.replace(/\//g, "_");
    await page.screenshot({ path: `${dossier}/mobile${nom}.png` });
    if (largeur > 391) debordements.push(`${p} : ${largeur}px`);
  }
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 391) debordements.push("/login");
  await page.screenshot({ path: `${dossier}/mobile_login.png` });
  verifier("mobile 390 px : aucune page ne déborde horizontalement", debordements.length === 0, debordements);
  await browser.close();
}

async function miseAJour(token: string, phase: string) {
  const ctx = await chromium.launchPersistentContext(PROFIL, { executablePath: CHROME });
  await cookie(ctx, token);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const caches1 = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("crm-")));
  if (phase === "mise-a-jour-1") {
    verifier("version initiale installée", caches1.length === 1, caches1);
  } else {
    // Nouvelle construction : le navigateur trouve la nouvelle version.
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const message = page.getByText("Une nouvelle version de CRM Master est disponible");
    await message.waitFor({ timeout: 30000 }).catch(() => undefined);
    verifier("nouvelle version signalée, sans rechargement imposé", await message.isVisible());
    await page.getByRole("button", { name: "Recharger" }).click();
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    const caches2 = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("crm-")));
    verifier("après « Recharger » : nouvelle version seule, ancien cache supprimé", caches2.length === 1 && caches2[0] !== caches1[0], { avant: caches1, apres: caches2 });
  }
  await ctx.close();
}

async function main() {
  const [token, dossier, phase = "complet"] = process.argv.slice(2);
  if (!token || !dossier) throw new Error("Usage : pwa-e2e.ts <jeton> <dossier> [phase]");
  mkdirSync(dossier, { recursive: true });

  if (phase === "complet") {
    await publiques();
    const browser = await chromium.launch({ executablePath: CHROME });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await cookie(ctx, token);
    // Chromium n'évalue pas l'installabilité en navigation privée : profil réel.
    const profil = await chromium.launchPersistentContext(`${PROFIL}-installabilite`, { executablePath: CHROME });
    await cookie(profil, token);
    await installabilite(profil);
    await profil.close();
    await cacheApresNavigation(ctx, dossier);
    await boutonInstallation(ctx, dossier);
    await connexionDeconnexion(ctx);
    await browser.close();
    await iphoneEtModeInstalle(token, dossier);
    await mobile(token, dossier);
  } else {
    await miseAJour(token, phase);
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(JSON.stringify({ phase, total: resultats.length, echecs: echecs.length, resultats }, null, 2));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
