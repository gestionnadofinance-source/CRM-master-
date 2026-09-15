"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { CreateCrmForm } from "./create-crm-form";

export function CreateCrmButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Ajouter un CRM
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau CRM" width="lg">
        <CreateCrmForm
          onCreated={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}
