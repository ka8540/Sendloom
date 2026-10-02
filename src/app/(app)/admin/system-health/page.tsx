import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
export default async function SystemHealthRedirect() {
  await requireAdminUser();
  redirect("/admin/operations");
}
