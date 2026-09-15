import { requireAuthOrRedirect } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { FirstLoginForm } from "./first-login-form";

export default async function FirstLoginPage() {
  // Ne peut pas utiliser requireActiveAuth() ici : elle redirige elle-même
  // vers /first-login tant que mustChangePassword est vrai, ce qui
  // boucherait indéfiniment sur cette page.
  const ctx = await requireAuthOrRedirect();
  if (!ctx.user.mustChangePassword) {
    redirect("/home");
  }

  return (
    <AuthShell
      title="Choisissez votre mot de passe"
      subtitle="C'est votre première connexion : le mot de passe temporaire doit être remplacé."
    >
      <FirstLoginForm />
    </AuthShell>
  );
}
