import { headers } from "next/headers";

import { AppMobileGate } from "@/components/app-mobile-gate";
import { AppNav } from "@/components/nav";
import { BackButton } from "@/components/back-button";
import { isAdminUser, requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? "";

  return (
    <AppMobileGate userAgent={userAgent}>
      <div className="shell">
        <AppNav isAdmin={isAdminUser(user)} />
        <main className="content">
          <div className="content-toolbar">
            <BackButton />
          </div>
          {children}
        </main>
      </div>
    </AppMobileGate>
  );
}
