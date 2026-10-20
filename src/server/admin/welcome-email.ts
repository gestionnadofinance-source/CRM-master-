import "server-only";

/**
 * Mail d'accès d'un utilisateur : un seul modèle, qu'il parte en brouillon
 * Gmail (à relire puis envoyer par l'administrateur) ou par SMTP. Deux
 * occasions : la création du compte, et la régénération du mot de passe.
 */
export interface WelcomeEmailInput {
  /** "bienvenue" à la création du compte, "reinitialisation" quand l'administrateur régénère le mot de passe. */
  kind?: "bienvenue" | "reinitialisation";
  firstName: string;
  email: string;
  temporaryPassword: string;
  /** Adresse de la page de connexion, l'email déjà rempli. */
  loginUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function loginUrlFor(origin: string, email: string): string {
  const url = new URL("/login", origin);
  url.searchParams.set("email", email);
  return url.toString();
}

export function buildWelcomeEmail(input: WelcomeEmailInput): { subject: string; text: string; html: string } {
  const reinit = input.kind === "reinitialisation";
  const subject = reinit ? "CRM Master — votre nouveau mot de passe provisoire" : "Bienvenue sur CRM Master — vos accès";
  const intro = reinit
    ? "Votre mot de passe CRM Master a été réinitialisé par un administrateur."
    : "Un compte vient d'être créé pour vous sur CRM Master.";
  const consigne = reinit
    ? "Il vous sera demandé de choisir un nouveau mot de passe dès votre prochaine connexion."
    : "Il vous sera demandé de choisir votre propre mot de passe dès la première connexion.";
  const text = [
    `Bonjour ${input.firstName},`,
    "",
    intro,
    "",
    `Pour vous connecter : ${input.loginUrl}`,
    `Identifiant : ${input.email}`,
    `Mot de passe provisoire : ${input.temporaryPassword}`,
    "",
    consigne,
  ].join("\n");

  const url = escapeHtml(input.loginUrl);
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#1d3cd6;padding:20px 32px;">
                <span style="color:#fff;font-size:18px;font-weight:bold;">CRM Master</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#111827;font-size:14px;line-height:1.5;">
                <p style="margin:0 0 12px;">Bonjour ${escapeHtml(input.firstName)},</p>
                <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${url}" style="display:inline-block;background:#1d3cd6;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:6px;">Se connecter à CRM Master</a>
                </p>
                <p style="margin:0 0 4px;">Identifiant : <strong>${escapeHtml(input.email)}</strong></p>
                <p style="margin:0 0 20px;">Mot de passe provisoire : <strong>${escapeHtml(input.temporaryPassword)}</strong></p>
                <p style="margin:0 0 12px;">${escapeHtml(consigne)}</p>
                <p style="margin:0;color:#6b7280;font-size:12px;">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br/>${url}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, text, html };
}
