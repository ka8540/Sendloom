import { AppNav } from "@/components/nav";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="shell">
      <AppNav />
      <main className="content">{children}</main>
    </div>
  );
}
