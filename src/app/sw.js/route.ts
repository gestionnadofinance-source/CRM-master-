/**
 * Service worker de l'application installable, servi à /sw.js.
 *
 * Règle de conduite : le CRM reste une application CONNECTÉE. Le service
 * worker n'existe que pour l'installation, une page claire en cas de coupure
 * réseau et le chargement rapide des fichiers statiques publics. Il ne met
 * JAMAIS en cache une page, une réponse d'API, une action serveur, une donnée
 * de page (RSC) ni un document du coffre-fort : tout cela n'est même pas
 * intercepté et passe directement par le réseau, avec la session de
 * l'utilisateur, exactement comme dans un navigateur sans service worker.
 *
 * Mises à jour : la version change à chaque déploiement (le fichier est
 * figé à la construction). Le navigateur détecte le nouveau fichier, installe
 * la nouvelle version, qui attend que l'utilisateur choisisse « Recharger »
 * (src/components/pwa/pwa-provider.tsx) : jamais de rechargement imposé au
 * milieu d'une saisie. Les caches des versions précédentes sont supprimés.
 */
export const dynamic = "force-static";

const VERSION = process.env.VERCEL_GIT_COMMIT_SHA
  ? `${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)}-${Date.now()}`
  : String(Date.now());

const SCRIPT = `
const VERSION = ${JSON.stringify(VERSION)};
const STATIC_CACHE = "crm-static-" + VERSION;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  // Pas de skipWaiting ici : la nouvelle version attend l'accord de l'utilisateur.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("crm-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Fichiers publics, identiques pour tous les utilisateurs et nommés par leur
// contenu : les seuls qu'on ait le droit de garder.
function isPublicStatic(url) {
  return url.pathname.startsWith("/_next/static/") || /^\\/icons\\/[a-z0-9-]+\\.png$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Pages : toujours le réseau, jamais de copie. Coupure réseau : page
    // d'information, sans aucune donnée.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isPublicStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      })
    );
  }
  // Tout le reste n'est pas intercepté.
});
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Toujours revalidé : sinon une mise à jour pourrait rester invisible.
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
