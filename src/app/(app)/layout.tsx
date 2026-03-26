import { AppNav } from "@/components/nav";
import { BackButton } from "@/components/back-button";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="shell">
      <AppNav />
      <main className="content">
        <div className="content-toolbar">
          <BackButton />
        </div>
        {children}
      </main>
    </div>
  );
}
