import { AppNav } from "@/components/nav";
import { BackButton } from "@/components/back-button";
import { isAdminUser, requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="shell">
      <AppNav isAdmin={isAdminUser(user)} />
      <main className="content">
        <div className="content-toolbar">
          <BackButton />
        </div>
        {children}
      </main>
    </div>
  );
}
