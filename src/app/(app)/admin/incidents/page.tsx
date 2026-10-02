import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
export default async function IncidentsRedirect() {
  await requireAdminUser();
  redirect("/admin/operations/incidents");
}
