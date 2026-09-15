"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { ClientForm } from "./client-form";

export function NewClientButton({
  crmId,
  crmSlug,
  sources,
  tags,
  members,
  currentUserId,
}: {
  crmId: string;
  crmSlug: string;
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  members: { id: string; firstName: string; lastName: string }[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Nouveau client
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau client" width="lg">
        <ClientForm
          crmId={crmId}
          crmSlug={crmSlug}
          sources={sources}
          tags={tags}
          members={members}
          currentUserId={currentUserId}
          onSuccess={(clientId) => {
            setOpen(false);
            router.push(`/c/${crmSlug}/clients/${clientId}`);
          }}
        />
      </Modal>
    </>
  );
}
