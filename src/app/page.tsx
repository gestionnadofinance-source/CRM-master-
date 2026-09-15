import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/session";

export default async function RootPage() {
  const ctx = await getAuthContext();
  redirect(ctx ? "/home" : "/login");
}
