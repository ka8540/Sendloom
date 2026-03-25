import { AppNav } from "@/components/nav";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="shell">
      <AppNav />
      <main className="content">
        <div className="app-toolbar">
          <ThemeSwitcher />
        </div>
        <div className="app-page">{children}</div>
      </main>
    </div>
  );
}
