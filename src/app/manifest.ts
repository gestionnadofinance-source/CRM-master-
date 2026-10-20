import type { MetadataRoute } from "next";

/**
 * Manifeste de l'application installable (servi à /manifest.webmanifest et
 * lié automatiquement dans <head> par Next.js).
 *
 * Il ne décrit que l'enveloppe de l'application : nom, icônes, couleurs.
 * Il ne contient aucune donnée et n'ouvre aucune route — /home reste protégée
 * comme dans le navigateur : sans session, l'application installée s'ouvre
 * sur l'écran de connexion.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CRM Master",
    short_name: "CRM Master",
    description: "Gestion interne : planning, pointage, coffre-fort et paie.",
    lang: "fr",
    dir: "ltr",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Couleurs de l'identité existante (src/app/globals.css : --brand, --bg).
    theme_color: "#254DEA",
    background_color: "#FAFAFB",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
