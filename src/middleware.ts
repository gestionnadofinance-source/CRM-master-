import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "crm_master_session";

// Accessible sans session (pré-authentification). Les identifiants sont
// intégralement gérés par un administrateur (voir src/server/admin/actions.ts)
// : pas de 2FA ni de réinitialisation en self-service par email.
const PRE_AUTH_PATHS = ["/login"];

// Accessible uniquement AVEC une session, mais ne doit jamais être quittée
// automatiquement vers /home par ce middleware : c'est la page qui force le
// changement du mot de passe temporaire (voir /first-login/page.tsx et
// requireActiveAuth côté serveur, seul endroit capable de lire
// mustChangePassword en base).
const POST_AUTH_ONLY_PATHS = ["/first-login"];

/**
 * Garde-fou léger au niveau du edge : redirige selon la simple présence du
 * cookie de session. La validation forte (session non expirée/révoquée,
 * permissions, accès CRM) est systématiquement refaite côté serveur
 * (src/server/auth, src/server/tenant) car elle nécessite Prisma/la base
 * de données, indisponible en edge runtime. Ce middleware ne doit jamais
 * être considéré comme la seule protection.
 */
// Transmet le chemin courant aux Server Components via un en-tête de
// requête : un layout serveur (ex. src/app/c/[crmSlug]/layout.tsx) n'a
// normalement aucun moyen de connaître l'URL demandée, alors qu'il en a
// besoin pour restreindre certaines pages selon la catégorie d'accès
// (Ouvrier/Commercial) sans dupliquer ce contrôle dans chaque page.
function withPathnameHeader(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/book/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPreAuthPath = PRE_AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isPostAuthOnlyPath = POST_AUTH_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPreAuthPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!hasSession && isPostAuthOnlyPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Ne redirige JAMAIS /login vers /home sur la seule présence du cookie
  // (contrairement à un ancien comportement) : ce cookie peut être
  // périmé (session expirée/révoquée, ex. mot de passe changé par un
  // administrateur) sans que le navigateur l'ait purgé, et un Server
  // Component ne peut pas supprimer de cookie pour corriger ça — seule
  // une Server Action/Route Handler le peut. C'est donc /login lui-même
  // (src/app/login/page.tsx) qui revalide en base et redirige vers
  // /home s'il existe réellement une session active, évitant toute
  // boucle de redirection.

  return withPathnameHeader(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
