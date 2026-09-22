"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { ThemePreference } from "@prisma/client";

export async function setThemePreference(theme: ThemePreference): Promise<void> {
  const ctx = await requireAuth();
  await prisma.user.update({ where: { id: ctx.user.id }, data: { theme } });
  const cookieStore = await cookies();
  cookieStore.set("theme", theme.toLowerCase(), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Lu par le script de thème côté client (voir ThemeScript), donc pas
    // httpOnly — mais rien ne justifie de l'émettre en clair : `secure` en
    // production, jamais en développement local où l'application est en HTTP.
    secure: process.env.NODE_ENV === "production",
  });
}
