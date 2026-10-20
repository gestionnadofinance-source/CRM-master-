import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  // Revalide en base plutôt que de se fier au middleware (qui ne fait
  // qu'un contrôle léger de présence du cookie) : évite de renvoyer un
  // utilisateur déjà connecté vers le formulaire, tout en gérant
  // proprement un cookie périmé (session expirée/révoquée) sans jamais
  // boucler — voir src/proxy.ts.
  const ctx = await getAuthContext();
  if (ctx) {
    redirect(ctx.user.mustChangePassword ? "/first-login" : "/home");
  }

  return (
    <AuthShell title="Connexion" subtitle="Accédez à votre espace de gestion commerciale interne.">
      {/* Le lien du mail de bienvenue arrive avec l'email déjà rempli. */}
      <LoginForm defaultEmail={(await searchParams).email?.slice(0, 254) ?? ""} />
    </AuthShell>
  );
}
