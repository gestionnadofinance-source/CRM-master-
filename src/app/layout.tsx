import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/components/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Master",
  description: "Gestion commerciale interne",
  // Outil interne : aucune page ne doit être indexée. Double ceinture avec
  // src/app/robots.ts — robots.txt est une consigne qu'un robot peut ignorer,
  // la balise meta est lue au moment de l'indexation elle-même.
  robots: { index: false, follow: false },
};

// Sans ce viewport, un navigateur mobile rend la page comme si l'écran
// faisait ~980px de large puis dézoome pour l'afficher en entier : aucune
// des classes responsive Tailwind (sm:/md:/lg:) ne se déclenche jamais sur
// un vrai téléphone, quel que soit le travail fait par ailleurs.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
