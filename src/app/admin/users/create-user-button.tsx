"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { CreateUserForm } from "./create-user-form";

export function CreateUserButton({ crms }: { crms: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Nouvel utilisateur
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Créer un utilisateur" width="lg">
        <CreateUserForm crms={crms} onCreated={() => router.refresh()} />
      </Modal>
    </>
  );
}
