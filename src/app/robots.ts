import type { MetadataRoute } from "next";

/**
 * CRM interne : rien n'a vocation à être indexé.
 *
 * L'application est entièrement derrière authentification, à une exception
 * près — la page de réservation publique /book/[publicSlug], dont le lien est
 * transmis directement aux clients et n'a pas à être trouvable par recherche.
 * Laisser le domaine indexable exposerait la structure de l'outil interne
 * (routes /admin, /c/<crm>/...) à la simple curiosité d'un moteur.
 *
 * Si un jour la page de réservation doit être référencée, il suffit d'ajouter
 * une règle `{ userAgent: "*", allow: "/book/" }` avant le disallow général.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
