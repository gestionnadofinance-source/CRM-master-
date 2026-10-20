import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { buildAuthorizationUrl, googleClientConfig, OAUTH_STATE_COOKIE, redirectUriFor } from "@/server/google/gmail";

/**
 * Départ de la liaison d'un compte Gmail (administrateurs uniquement) :
 * redirige vers l'écran d'autorisation Google, avec un `state` aléatoire
 * gardé en cookie pour vérifier au retour que c'est bien CET administrateur
 * qui a lancé la liaison — et non un site tiers.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx?.user.isGlobalAdmin) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }

  const back = new URL("/admin/users", request.nextUrl.origin);
  const cfg = googleClientConfig();
  if (!cfg) {
    back.searchParams.set("gmail", "non_configure");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(
    buildAuthorizationUrl(state, redirectUriFor(request.nextUrl.origin), cfg.clientId)
  );
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge: 10 * 60,
  });
  return res;
}
