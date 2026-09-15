import { redirect } from "next/navigation";
import { requireActiveAuth } from "@/server/auth/session";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireActiveAuth();
  if (!ctx.user.isGlobalAdmin) {
    redirect("/home");
  }

  return <AdminShell user={ctx.user}>{children}</AdminShell>;
}
