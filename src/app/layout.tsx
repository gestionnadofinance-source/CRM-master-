import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/components/theme-script";
import { PwaEarlyScript } from "@/components/pwa/pwa-early-script";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Master",
  description: "Gestion commerciale interne",
  // Outil interne : aucune page ne doit être indexée. Double ceinture avec
  // src/app/robots.ts — robots.txt est une consigne qu'un robot peut ignorer,
  // la balise meta est lue au moment de l'indexation elle-même.
  robots: { index: false, follow: false },
  // Application installable : icônes et réglages Apple (iOS ne lit pas les
  // icônes du manifeste pour l'écran d'accueil). Le manifeste lui-même est
  // lié automatiquement par Next.js (src/app/manifest.ts).
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "CRM Master",
    // « default » : barre d'état opaque, le contenu ne passe pas dessous.
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

// Sans ce viewport, un navigateur mobile rend la page comme si l'écran
// faisait ~980px de large puis dézoome pour l'afficher en entier : aucune
// des classes responsive Tailwind (sm:/md:/lg:) ne se déclenche jamais sur
// un vrai téléphone, quel que soit le travail fait par ailleurs.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Couleur de la barre de titre de l'application installée (--brand).
  themeColor: "#254DEA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <PwaEarlyScript />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        {children}
        <PwaProvider />
      </body>
    </html>
  );
}
