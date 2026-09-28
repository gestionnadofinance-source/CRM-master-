import { redirect } from "next/navigation";

/**
 * Racine d'un espace : renvoie vers Planning, seule page commune à tous les
 * profils (administrateur, secrétaire/comptable, ouvrier).
 *
 * Sans cette page, l'URL `/c/<slug>` ne correspondait à aucune route : Next
 * répondait 404 sans jamais exécuter le layout, donc sans que la garde
 * d'accès puisse rediriger. Le tableau de bord par espace qui occupait cette
 * place a disparu avec le volet commercial.
 */
export default async function CrmRootPage({ params }: { params: Promise<{ crmSlug: string }> }) {
  const { crmSlug } = await params;
  redirect(`/c/${crmSlug}/planning`);
}
