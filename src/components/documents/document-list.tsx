"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import { FileText, Trash2, Upload, Download } from "lucide-react";
import { uploadDocument, listDocuments, deleteDocument } from "@/server/documents/actions";
import { formatDate } from "@/lib/utils";
import type { DocumentEntity } from "@prisma/client";

type DocumentItem = Awaited<ReturnType<typeof listDocuments>>[number];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentList({
  crmId,
  entityType,
  entityId,
  canDelete = true,
}: {
  crmId: string;
  entityType: DocumentEntity;
  entityId: string;
  canDelete?: boolean;
}) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const list = await listDocuments(crmId, entityType, entityId);
    setDocs(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crmId, entityType, entityId]);

  function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const formData = new FormData();
    formData.set("file", files[0]!);
    startTransition(async () => {
      const res = await uploadDocument(crmId, entityType, entityId, formData);
      if (!res.ok) setError(res.error ?? "Échec de l'envoi.");
      else await refresh();
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Documents</p>
        <label className="cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            disabled={isPending}
          />
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-bg-subtle">
            <Upload className="h-3.5 w-3.5" />
            {isPending ? "Envoi..." : "Ajouter"}
          </span>
        </label>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted">Chargement...</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted">Aucun document.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{doc.fileName}</p>
                <p className="text-[11px] text-muted">
                  {formatSize(doc.size)} · {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} · {formatDate(doc.createdAt, true)}
                </p>
              </div>
              <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">
                <Download className="h-4 w-4" />
              </a>
              {canDelete && (
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await deleteDocument(crmId, doc.id);
                      await refresh();
                    })
                  }
                  className="text-muted hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
