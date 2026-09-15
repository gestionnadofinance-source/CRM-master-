"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { CreateApiKeyForm } from "./create-api-key-form";

export function CreateApiKeyButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" />
        Nouvelle clé
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Créer une clé API">
        <CreateApiKeyForm onCreated={() => router.refresh()} />
      </Modal>
    </>
  );
}
