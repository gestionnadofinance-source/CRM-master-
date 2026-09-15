import "server-only";
import nodemailer from "nodemailer";
import { getServerEnv, isEmailConfigured } from "@/lib/env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;
  const env = getServerEnv();
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transporter;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/**
 * Envoie un email si le SMTP est configuré. En absence de configuration
 * (environnement de démo/dev), le message est journalisé côté serveur
 * plutôt que de faire échouer silencieusement le flux applicatif — mais
 * le code appelant doit rester utilisable en conditions réelles dès que
 * les variables SMTP_* sont renseignées.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  const env = getServerEnv();
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[email] SMTP non configuré — email non envoyé à ${input.to}: "${input.subject}"`
    );
    return { delivered: false };
  }
  await t.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  });
  return { delivered: true };
}

export function baseEmailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
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
              <td style="padding:32px;color:#111827;">
                <h1 style="font-size:18px;margin:0 0 16px;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;color:#9ca3af;font-size:12px;">
                Ce message a été envoyé automatiquement par CRM Master. Ne pas répondre.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
