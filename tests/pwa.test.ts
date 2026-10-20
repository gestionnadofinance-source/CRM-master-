/**
 * Application installable (PWA) : ce qui doit rester vrai quoi qu'il arrive.
 *
 * - Le middleware ne laisse passer SANS session que l'enveloppe publique de
 *   l'application (manifeste, service worker, icônes, page hors ligne) :
 *   aucune page, aucune API.
 * - Le service worker ne met en cache que des fichiers statiques publics ;
 *   pages, API, actions serveur et données de page ne sont jamais gardées.
 * - Le manifeste et ses icônes sont complets et conformes.
 * - Chaque appareil reçoit des instructions d'installation adaptées, sans
 *   promettre une installation automatique là où elle n'existe pas (iOS).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import proxy, { isPublicPwaAsset } from "@/proxy";
import manifest from "@/app/manifest";
import { GET as serviceWorker } from "@/app/sw.js/route";
import { canProposeManualInstall, detectPlatform, installHelp } from "@/lib/pwa/platform";

// --- Middleware ----------------------------------------------------------------
describe("middleware : seule l'enveloppe publique de l'application est lisible sans session", () => {
  it("laisse passer manifeste, service worker, page hors ligne et icônes", () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/maskable-512.png"]) {
      expect(isPublicPwaAsset(p), p).toBe(true);
    }
  });

  it("ne laisse passer aucune page, aucune API, aucun détournement de chemin", () => {
    for (const p of [
      "/home", "/admin", "/admin/users", "/c/fidem-froid-clim/vault", "/api/vault/abc", "/api/google/connexion",
      "/icons/../home", "/icons/a/b.png", "/icons/icon.svg", "/sw.js/x", "/manifest.webmanifest.json", "/icons/",
    ]) {
      expect(isPublicPwaAsset(p), p).toBe(false);
    }
  });

  it("sans cookie : le manifeste est servi, une page privée renvoie toujours vers la connexion", () => {
    const manifeste = proxy(new NextRequest("https://crm.exemple.fr/manifest.webmanifest"));
    expect(manifeste.headers.get("location")).toBeNull();

    for (const p of ["/home", "/c/fidem-froid-clim/pointage-salaries", "/admin/users"]) {
      const res = proxy(new NextRequest(`https://crm.exemple.fr${p}`));
      expect(new URL(res.headers.get("location")!).pathname, p).toBe("/login");
    }
  });
});

// --- Manifeste et icônes ---------------------------------------------------------
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("manifeste", () => {
  const m = manifest();

  it("décrit une application autonome, à la racine, ouverte sur l'accueil", () => {
    expect(m).toMatchObject({
      name: "CRM Master",
      short_name: "CRM Master",
      start_url: "/home",
      scope: "/",
      id: "/",
      display: "standalone",
      theme_color: "#254DEA",
      background_color: "#FAFAFB",
    });
  });

  it("déclare des icônes 192 et 512, normales et maskable, qui existent aux bonnes tailles", () => {
    const icons = m.icons ?? [];
    for (const [size, purpose] of [["192x192", "any"], ["512x512", "any"], ["192x192", "maskable"], ["512x512", "maskable"]]) {
      expect(icons.some((i) => i.sizes === size && i.purpose === purpose), `${size} ${purpose}`).toBe(true);
    }
    for (const icon of icons) {
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect(pngSize(`public${icon.src}`), icon.src).toEqual({ width: w, height: h });
      expect(isPublicPwaAsset(icon.src), icon.src).toBe(true);
    }
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});

// --- Service worker -------------------------------------------------------------
type Listener = (event: unknown) => void;

/** Exécute le vrai script du service worker dans un environnement simulé. */
async function chargerServiceWorker() {
  const res = serviceWorker();
  const script = await res.text();
  const listeners: Record<string, Listener[]> = {};
  const caches = new Map<string, Map<string, Response>>();
  const reseau: string[] = [];
  const self = {
    location: { origin: "https://crm.exemple.fr" },
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const cacheStorage = {
    open: async (name: string) => {
      const c = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, c);
      return {
        match: async (req: { url: string } | string) => c.get(typeof req === "string" ? req : req.url)?.clone(),
        put: async (req: { url: string }, r: Response) => void c.set(req.url, r),
        addAll: async (urls: string[]) => urls.forEach((u) => c.set(u, new Response("precache"))),
      };
    },
    match: async (url: string) => {
      for (const c of caches.values()) if (c.has(url)) return c.get(url)!.clone();
      return undefined;
    },
    keys: async () => Array.from(caches.keys()),
    delete: async (name: string) => caches.delete(name),
  };
  let enLigne = true;
  const fetchSimule = async (req: { url: string }) => {
    reseau.push(req.url);
    if (!enLigne) throw new TypeError("Failed to fetch");
    const r = new Response(`réseau:${req.url}`, { status: 200 });
    Object.defineProperty(r, "type", { value: "basic" });
    return r;
  };
  new Function("self", "caches", "fetch", script)(self, cacheStorage, fetchSimule);

  async function requete(url: string, init: { method?: string; mode?: string } = {}) {
    let reponse: Promise<Response> | null = null;
    const event = {
      request: { url: new URL(url, self.location.origin).toString(), method: init.method ?? "GET", mode: init.mode ?? "cors" },
      respondWith: (p: Promise<Response>) => (reponse = p),
    };
    for (const fn of listeners.fetch ?? []) fn(event);
    return reponse === null ? null : await (reponse as Promise<Response>);
  }
  async function installer() {
    const promesses: Promise<unknown>[] = [];
    for (const fn of listeners.install ?? []) fn({ waitUntil: (p: Promise<unknown>) => promesses.push(p) });
    await Promise.all(promesses);
  }
  return { res, script, requete, installer, caches, reseau, horsLigne: () => (enLigne = false) };
}

describe("service worker", () => {
  it("est servi comme JavaScript jamais mis en cache HTTP", async () => {
    const { res } = await chargerServiceWorker();
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("n'intercepte ni les API, ni les actions serveur, ni les données de page, ni les documents", async () => {
    const sw = await chargerServiceWorker();
    await sw.installer();
    expect(await sw.requete("/api/vault/doc-1")).toBeNull();
    expect(await sw.requete("/api/public/v1/pointages")).toBeNull();
    expect(await sw.requete("/c/fidem-froid-clim/pointage-salaries", { method: "POST" })).toBeNull(); // action serveur
    expect(await sw.requete("/c/fidem-froid-clim/vault?_rsc=abc")).toBeNull(); // données de page (RSC)
    expect(await sw.requete("https://autre-site.fr/x.js")).toBeNull();
  });

  it("sert les pages depuis le réseau, sans jamais les garder", async () => {
    const sw = await chargerServiceWorker();
    await sw.installer();
    const page = await sw.requete("/c/fidem-froid-clim/vault", { mode: "navigate" });
    expect(await page!.text()).toBe("réseau:https://crm.exemple.fr/c/fidem-froid-clim/vault");
    const gardees = Array.from(sw.caches.values()).flatMap((c) => Array.from(c.keys()));
    expect(gardees.filter((u) => u.includes("/c/") || u.includes("/home") || u.includes("/api/"))).toEqual([]);
  });

  it("hors ligne : une page d'information, jamais une copie d'une page privée", async () => {
    const sw = await chargerServiceWorker();
    await sw.installer();
    sw.horsLigne();
    const page = await sw.requete("/home", { mode: "navigate" });
    expect(await page!.text()).toBe("precache"); // /offline.html, précachée à l'installation
  });

  it("garde uniquement les fichiers statiques publics versionnés", async () => {
    const sw = await chargerServiceWorker();
    await sw.installer();
    await sw.requete("/_next/static/chunks/app-123abc.js");
    const avant = sw.reseau.length;
    const deuxieme = await sw.requete("/_next/static/chunks/app-123abc.js");
    expect(await deuxieme!.text()).toBe("réseau:https://crm.exemple.fr/_next/static/chunks/app-123abc.js");
    expect(sw.reseau.length).toBe(avant); // servi depuis le cache, sans réseau
    const gardees = Array.from(sw.caches.values()).flatMap((c) => Array.from(c.keys()));
    for (const u of gardees) expect(u, u).toMatch(/^(\/offline\.html|\/icons\/[a-z0-9-]+\.png|https:\/\/crm\.exemple\.fr\/_next\/static\/.+)$/);
  });

  it("change à chaque construction, pour que les mises à jour soient détectées", async () => {
    const { script } = await chargerServiceWorker();
    expect(script).toMatch(/const VERSION = "[^"]+";/);
    expect(script).not.toContain("skipWaiting();\n});\n\nself.addEventListener(\"activate\""); // pas de saut automatique à l'installation
    expect(script).toContain('event.data === "SKIP_WAITING"');
  });
});

// --- Instructions par appareil ----------------------------------------------------
const UA = {
  iphoneSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
};

describe("détection de l'appareil et instructions d'installation", () => {
  it("iPhone avec Safari : partage → « Sur l'écran d'accueil », sans promettre d'installation automatique", () => {
    const p = detectPlatform(UA.iphoneSafari17, 5);
    expect(p).toMatchObject({ os: "ios", browser: "safari", iosVersion: 17, isIpad: false });
    const h = installHelp(p);
    expect(h.supported).toBe(true);
    expect(h.steps.join(" ")).toContain("Sur l'écran d'accueil");
    expect(h.steps.join(" ")).toContain("en bas de l'écran");
    expect(h.note).toContain("ne permet pas à un site de lancer lui-même l'installation");
    expect(canProposeManualInstall(p)).toBe(true);
  });

  it("iOS 26 : le partage est dans le menu « ••• »", () => {
    const p = detectPlatform(UA.iphoneSafari26, 5);
    expect(p.iosVersion).toBe(26);
    expect(installHelp(p).steps.join(" ")).toContain("••• ");
  });

  it("un iPad qui se présente comme un Mac est reconnu comme iPad", () => {
    const p = detectPlatform(UA.ipadAsMac, 5);
    expect(p).toMatchObject({ os: "ios", isIpad: true });
    expect(installHelp(p).title).toContain("l'iPad");
    // Le même navigateur sans écran tactile est un vrai Mac.
    expect(detectPlatform(UA.ipadAsMac, 0).os).toBe("macos");
  });

  it("navigateur intégré (Instagram) : expliquer d'ouvrir dans Safari", () => {
    const h = installHelp(detectPlatform(UA.iphoneInstagram, 5));
    expect(h.supported).toBe(false);
    expect(h.steps.join(" ")).toContain("Ouvrir dans Safari");
  });

  it("Chrome sur iPhone (iOS 16.4 et plus) passe aussi par le partage", () => {
    const p = detectPlatform(UA.iphoneChrome, 5);
    expect(p).toMatchObject({ os: "ios", browser: "chrome" });
    expect(installHelp(p).supported).toBe(true);
  });

  it("Android, Samsung, Windows, Mac et Firefox : chacun ses étapes", () => {
    expect(installHelp(detectPlatform(UA.androidChrome)).steps.join(" ")).toContain("Installer l'application");
    expect(detectPlatform(UA.androidSamsung).browser).toBe("samsung");
    expect(installHelp(detectPlatform(UA.androidSamsung)).steps.join(" ")).toContain("Écran d'accueil");
    expect(detectPlatform(UA.windowsEdge)).toMatchObject({ os: "windows", browser: "edge" });
    expect(installHelp(detectPlatform(UA.windowsEdge)).steps.join(" ")).toContain("Installer ce site en tant qu'application");
    expect(installHelp(detectPlatform(UA.windowsChrome)).steps.join(" ")).toContain("Installer la page en tant qu'application");
    expect(installHelp(detectPlatform(UA.macSafari)).steps.join(" ")).toContain("Ajouter au Dock");
    const firefox = installHelp(detectPlatform(UA.windowsFirefox));
    expect(firefox.supported).toBe(false);
    expect(firefox.steps.join(" ")).toContain("Chrome ou Microsoft Edge");
    // Pas de bandeau sur un ordinateur sans installation possible.
    expect(canProposeManualInstall(detectPlatform(UA.windowsFirefox))).toBe(false);
  });
});
