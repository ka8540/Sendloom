"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { CollapsedSidebarTooltip } from "@/components/collapsed-sidebar-tooltip";
import { ThemeSwitcher } from "@/components/theme-switcher";

export function SessionControls({
  collapsed = false,
  utilityNav = null
}: {
  collapsed?: boolean;
  /** Lower account/settings nav rendered under a divider, above logout. */
  utilityNav?: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const redirectToLogin = useCallback(() => {
    router.replace("/login");
    router.refresh();
  }, [router]);

  const performLogout = useCallback(async () => {
    setPending(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST"
      });
    } catch {
      // Redirect anyway so expired or invalid sessions still leave the protected area.
    }

    redirectToLogin();
  }, [redirectToLogin]);

  const logoutButton = (
    <button
      className="nav-item nav-item-button"
      type="button"
      onClick={() => void performLogout()}
      disabled={pending}
      aria-label={collapsed ? "Log out" : undefined}
    >
      <LogOut aria-hidden="true" />
      <span>{pending ? "Signing out..." : "Log out"}</span>
    </button>
  );

  return (
    <div className="nav-footer">
      <div className="nav-footer-theme">
        {collapsed ? (
          <CollapsedSidebarTooltip label="Theme">
            <ThemeSwitcher className="theme-menu--footer" collapsed />
          </CollapsedSidebarTooltip>
        ) : (
          <ThemeSwitcher className="theme-menu--footer" />
        )}
      </div>
      {utilityNav ? (
        <>
          <div className="nav-footer-divider" role="separator" aria-hidden="true" />
          {utilityNav}
        </>
      ) : null}
      {collapsed ? (
        <CollapsedSidebarTooltip label="Log out">{logoutButton}</CollapsedSidebarTooltip>
      ) : logoutButton}
    </div>
  );
}
