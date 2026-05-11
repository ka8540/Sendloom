import { cookies, headers } from "next/headers";

import { AppMobileGate } from "@/components/app-mobile-gate";
import { AppNav } from "@/components/nav";
import { BackButton } from "@/components/back-button";
import { isAdminUser, requireUser } from "@/lib/auth";

const SIDEBAR_COLLAPSED_COOKIE_NAME = "sendloom_sidebar_collapsed";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sendloom.sidebarCollapsed";
const SIDEBAR_COLLAPSED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function SidebarPreferenceScript() {
  const script = `(() => {
  try {
    const cookieName = "${SIDEBAR_COLLAPSED_COOKIE_NAME}";
    const storageKey = "${SIDEBAR_COLLAPSED_STORAGE_KEY}";
    const maxAge = ${SIDEBAR_COLLAPSED_COOKIE_MAX_AGE};
    const cookieValue = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(cookieName + "="))
      ?.split("=")[1];
    let collapsed = cookieValue === "true" || cookieValue === "false" ? cookieValue : null;

    if (collapsed === null) {
      const storedValue = window.localStorage.getItem(storageKey);

      if (storedValue === "true" || storedValue === "false") {
        collapsed = storedValue;
        document.cookie = cookieName + "=" + collapsed + "; path=/; max-age=" + maxAge + "; SameSite=Lax";
      }
    }

    document.documentElement.dataset.sidebarCollapsed = collapsed === "true" ? "true" : "false";
  } catch {
    document.documentElement.dataset.sidebarCollapsed = "false";
  }
})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const userAgent = requestHeaders.get("user-agent") ?? "";
  const initialSidebarCollapsed = requestCookies.get(SIDEBAR_COLLAPSED_COOKIE_NAME)?.value === "true";
  const defaultBackHref = isAdminUser(user) ? "/admin" : "/workspace";

  return (
    <>
      <SidebarPreferenceScript />
      <AppMobileGate userAgent={userAgent}>
        <div className="shell">
          <AppNav initialCollapsed={initialSidebarCollapsed} isAdmin={isAdminUser(user)} />
          <main className="content">
            <div className="content-toolbar">
              <BackButton fallbackHref={defaultBackHref} />
            </div>
            {children}
          </main>
        </div>
      </AppMobileGate>
    </>
  );
}
