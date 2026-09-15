"use client";

import { useState } from "react";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Download, Trash2, HardHat } from "lucide-react";
import { listAccountingDocumentsForUser, type AccountingForemanGroup } from "@/server/accounting/actions";
import { deleteVaultDocument } from "@/server/vault/actions";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/card";
import { formatDate, initials } from "@/lib/utils";

type Group = AccountingForemanGroup;
type Employee = Group["employees"][number];
type Document = Awaited<ReturnType<typeof listAccountingDocumentsForUser>>[number];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function foremanLabel(foreman: Group["foreman"]): string {
  return foreman ? `${foreman.firstName} ${foreman.lastName}` : "Sans chef de chantier";
}

export function ComptabiliteClient({ crmId, groups }: { crmId: string; groups: Group[] }) {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function openEmployee(group: Group, employee: Employee) {
    setSelectedGroup(group);
    setSelectedEmployee(employee);
    setLoading(true);
    const list = await listAccountingDocumentsForUser(crmId, employee.id, group.foreman?.id ?? null);
    setDocs(list);
    setLoading(false);
  }

  function handleDelete(documentId: string) {
    if (!confirm("Supprimer ce tableau de comptabilité ?")) return;
    startTransition(async () => {
      await deleteVaultDocument(crmId, documentId);
      if (selectedGroup && selectedEmployee) {
        const list = await listAccountingDocumentsForUser(crmId, selectedEmployee.id, selectedGroup.foreman?.id ?? null);
        setDocs(list);
      }
    });
  }

  // Niveau 2 : tableaux d'un salarié, sous un chef de chantier donné.
  if (selectedGroup && selectedEmployee) {
    return (
      <Card>
        <CardHeader className="flex items-center gap-2">
          <button onClick={() => setSelectedEmployee(null)} className="text-muted hover:text-text">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: selectedEmployee.color }}
          >
            {initials(selectedEmployee.firstName, selectedEmployee.lastName)}
          </span>
          <CardTitle>
            {selectedEmployee.firstName} {selectedEmployee.lastName} — {foremanLabel(selectedGroup.foreman)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted">Chargement...</p>
          ) : docs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Aucun tableau généré pour ce salarié sous ce chef de chantier. Sélectionnez ses fiches de pointage dans
              le coffre-fort puis cliquez sur « Transformer en tableau de comptabilité ».
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text">{doc.fileName}</p>
                    <p className="text-[11px] text-muted">
                      {formatSize(doc.size)}
                      {doc.chantier ? ` · ${doc.chantier.name}` : ""} · généré par {doc.uploadedBy.firstName}{" "}
                      {doc.uploadedBy.lastName} le {formatDate(doc.createdAt, true)}
                    </p>
                  </div>
                  <a href={`/api/vault/${doc.id}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">
                    <Download className="h-4 w-4" />
                  </a>
                  <button disabled={isPending} onClick={() => handleDelete(doc.id)} className="text-muted hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  // Niveau 1 : salariés sous un chef de chantier donné.
  if (selectedGroup) {
    return (
      <Card>
        <CardHeader className="flex items-center gap-2">
          <button onClick={() => setSelectedGroup(null)} className="text-muted hover:text-text">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <HardHat className="h-4 w-4 text-muted" />
          <CardTitle>{foremanLabel(selectedGroup.foreman)}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {selectedGroup.employees.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => openEmployee(selectedGroup, e)}
                  className="flex w-full items-center justify-between gap-2.5 px-1 py-2.5 text-left hover:bg-bg-subtle"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: e.color }}
                    >
                      {initials(e.firstName, e.lastName)}
                    </span>
                    <p className="truncate text-sm text-text">
                      {e.firstName} {e.lastName}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    {e.documentCount} tableau{e.documentCount > 1 ? "x" : ""}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  // Niveau 0 : liste des chefs de chantier.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chefs de chantier</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {groups.map((g) => {
            const totalDocs = g.employees.reduce((sum, e) => sum + e.documentCount, 0);
            return (
              <li key={g.foreman?.id ?? "__none__"}>
                <button
                  onClick={() => setSelectedGroup(g)}
                  className="flex w-full flex-col items-start gap-1.5 px-1 py-2.5 text-left hover:bg-bg-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {g.foreman ? (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: g.foreman.color }}
                      >
                        {initials(g.foreman.firstName, g.foreman.lastName)}
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-muted">
                        <HardHat className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <p className="truncate text-sm text-text">{foremanLabel(g.foreman)}</p>
                    <Badge variant={g.foreman ? "brand" : "default"} className="shrink-0">
                      {g.employees.length} salarié{g.employees.length > 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <span className="pl-9 text-xs text-muted sm:pl-0">
                    {totalDocs} tableau{totalDocs > 1 ? "x" : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              Aucun tableau de comptabilité généré pour ce CRM pour le moment.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
