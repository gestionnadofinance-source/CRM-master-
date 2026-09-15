import { requireActiveAuth } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { GlobalTopbar } from "@/components/global-topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { SessionsList } from "./sessions-list";

export default async function SettingsPage() {
  const ctx = await requireActiveAuth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  const sessions = await prisma.session.findMany({
    where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-bg-subtle">
      <GlobalTopbar user={ctx.user} title="Paramètres personnels" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm user={user} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions actives</CardTitle>
          </CardHeader>
          <CardContent>
            <SessionsList sessions={sessions} currentSessionId={ctx.sessionId} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
