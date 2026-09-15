import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { getUserForEdit } from "@/server/admin/queries";
import { UserRowActions } from "../user-row-actions";
import { EditAccessForm } from "./edit-access-form";
import { DangerZone } from "./danger-zone";
import { RgpdTools } from "./rgpd-tools";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const [user, crms, activityCount] = await Promise.all([
    getUserForEdit(id),
    prisma.crm.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.activityLog.count({ where: { userId: id } }),
  ]);
  if (!user) notFound();

  const initialAccess = user.crmAccess.map((a) => ({
    crmId: a.crmId,
    role: a.role,
    category: a.category,
    isForeman: a.isForeman,
    defaultHourlyRate: Number(a.defaultHourlyRate),
    defaultHousingAllowance: Number(a.defaultHousingAllowance),
    defaultDirtAllowance: Number(a.defaultDirtAllowance),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Retour aux utilisateurs
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">
            {user.firstName} {user.lastName}
          </h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <Badge variant={user.status === "ACTIVE" ? "success" : "danger"}>
          {user.status === "ACTIVE" ? "Actif" : "Désactivé"}
        </Badge>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Compte</CardTitle>
          <UserRowActions userId={user.id} status={user.status} isSelf={user.id === ctx.user.id} />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted">Créé le</p>
            <p className="text-text">{formatDate(user.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Dernière modification</p>
            <p className="text-text">{formatDate(user.updatedAt)}</p>
          </div>
          {user.disabledAt && (
            <div>
              <p className="text-xs text-muted">Désactivé le</p>
              <p className="text-text">{formatDate(user.disabledAt)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted">Entrées du journal d&apos;activité</p>
            <p className="text-text">{activityCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rôle et accès CRM</CardTitle>
        </CardHeader>
        <CardContent>
          <EditAccessForm
            userId={user.id}
            firstName={user.firstName}
            lastName={user.lastName}
            isGlobalAdmin={user.isGlobalAdmin}
            crms={crms}
            initialAccess={initialAccess}
            isSelf={user.id === ctx.user.id}
          />
        </CardContent>
      </Card>

      <RgpdTools userId={user.id} email={user.email} status={user.status} isSelf={user.id === ctx.user.id} />

      <DangerZone userId={user.id} email={user.email} />
    </div>
  );
}
