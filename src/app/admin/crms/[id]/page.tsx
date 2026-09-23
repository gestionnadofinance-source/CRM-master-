import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/server/auth/session";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { EditCrmForm } from "./edit-crm-form";

export default async function EditCrmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (!ctx.user.isGlobalAdmin) notFound();

  const crm = await prisma.crm.findUnique({
    where: { id },
    include: { _count: { select: { userAccess: true } } },
  });
  if (!crm) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/admin/crms" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Retour aux CRM
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">{crm.name}</h1>
          <p className="text-sm text-muted">
            /c/{crm.slug} · {crm._count.userAccess} accès utilisateur(s) · créé le {formatDate(crm.createdAt)}
          </p>
        </div>
        <Badge variant={crm.isActive ? "success" : "default"}>{crm.isActive ? "Actif" : "Inactif"}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paramètres généraux</CardTitle>
        </CardHeader>
        <CardContent>
          <EditCrmForm
            crmId={crm.id}
            name={crm.name}
            description={crm.description ?? ""}
            color={crm.color}
            isActive={crm.isActive}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accès rapide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Link href={`/c/${crm.slug}/dashboard`} className="block text-brand hover:underline">
            Ouvrir le tableau de bord de ce CRM
          </Link>
          <Link href={`/c/${crm.slug}/settings`} className="block text-brand hover:underline">
            Paramètres détaillés du CRM (pipeline, sources, TVA, réservation, modèles...)
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
