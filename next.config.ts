import type { NextConfig } from "next";

// Autorise le realtime Pusher (WebSocket + repli SockJS) quel que soit le
// cluster configuré (PUSHER_CLUSTER), et l'API REST de son endpoint
// d'authentification qui reste, elle, same-origin (/api/pusher/auth).
//
// 'unsafe-eval' n'est ajouté qu'en développement : le rechargement à
// chaud de `next dev` (webpack HMR / source maps eval) en a besoin pour
// exécuter les modules, alors qu'un build de production ne l'utilise
// jamais (vérifié : aucune violation CSP sur `next build && next start`).
// Sans cette distinction, la CSP casse silencieusement toute
// interactivité côté client en développement local.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.pusher.com wss://*.pusher.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 16 a retiré l'exécution d'ESLint de `next build` (et la clé
  // `eslint` de sa configuration) : le lint n'est plus une étape du build.
  // Il reste appliqué par `npm run lint`, exécuté en intégration continue
  // avant le typecheck et les tests (.github/workflows/ci.yml).
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
  async headers() {
    return [
      {
        // Ne s'applique pas aux assets statiques _next/* : en-têtes de
        // sécurité utiles seulement sur les réponses de pages/API.
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS n'a d'effet que servi en HTTPS (Vercel) — inoffensif en dev HTTP local, ignoré par le navigateur.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
