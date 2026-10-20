import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/server/auth/session";
import { logActivity } from "@/server/activity";
import {
  encryptRefreshToken,
  exchangeCode,
  fetchAccountEmail,
  googleClientConfig,
  OAUTH_STATE_COOKIE,
  redirectUriFor,
} from "@/server/google/gmail";

/**
 * Retour de Google après autorisation. Chaque issue renvoie vers
 * l'administration avec un statut lisible (?gmail=...), traduit en phrase
 * par l'écran Utilisateurs.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const ctx = await getAuthContext();
  if (!ctx?.user.isGlobalAdmin) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const params = request.nextUrl.searchParams;
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const finish = (statut: string) => {
    const back = new URL("/admin/users", origin);
    back.searchParams.set("gmail", statut);
    const res = NextResponse.redirect(back);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
    return res;
  };

  // Sans cette vérification, n'importe quel site pourrait faire relier un
  // compte de son choix à l'insu de l'administrateur.
  const state = params.get("state");
  if (!expected || !state || state !== expected) return finish("etat_invalide");
  if (params.get("error")) return finish("refus");

  const code = params.get("code");
  const cfg = googleClientConfig();
  if (!cfg) return finish("non_configure");
  if (!code) return finish("erreur");

  try {
    const redirectUri = redirectUriFor(origin);
    const tokens = await exchangeCode(code, redirectUri, cfg);
    // Google ne redonne ce jeton qu'au premier accord : sans lui, la liaison
    // expirerait dans l'heure. On n'enregistre rien et on explique pourquoi.
    if (!tokens.refreshToken) return finish("sans_jeton");
    const email = await fetchAccountEmail(tokens.accessToken);

    const data = {
      email,
      refreshTokenEncrypted: encryptRefreshToken(tokens.refreshToken, cfg.clientSecret),
      scope: tokens.scope,
      connectedAt: new Date(),
      lastError: null,
    };
    await prisma.googleMailAccount.upsert({
      where: { userId: ctx.user.id },
      create: { userId: ctx.user.id, ...data },
      update: data,
    });
    await logActivity({
      crmId: null,
      userId: ctx.user.id,
      action: "gmail.account_linked",
      entityType: "GoogleMailAccount",
      newValue: { email },
    });
    return finish("ok");
  } catch (err) {
    console.error("[gmail] échec de la liaison du compte", err);
    return finish("erreur");
  }
}
