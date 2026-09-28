import type { MetadataRoute } from "next";

/**
 * CRM interne : rien n'a vocation à être indexé.
 *
 * L'application est entièrement derrière authentification. Laisser le
 * domaine indexable exposerait la structure de l'outil interne (routes
 * /admin, /c/<espace>/...) à la simple curiosité d'un moteur.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
