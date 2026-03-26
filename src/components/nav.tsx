"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, House, PanelLeftClose, PanelLeftOpen, ScrollText, SendHorizontal, ShieldAlert } from "lucide-react";
import { SendloomLogo } from "@/components/sendloom-logo";
import { SessionControls } from "@/components/session-controls";

export function AppNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items = [
    { href: "/workspace", label: "Overview", icon: House },
    { href: "/imports", label: "Imports", icon: FileSpreadsheet },
    { href: "/templates", label: "Templates", icon: ScrollText },
    { href: "/campaigns", label: "Sequences", icon: SendHorizontal },
    { href: "/suppressions", label: "Suppressions", icon: ShieldAlert }
  ] as const;

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">
            <SendloomLogo />
          </div>
          <div className="brand-copy">
            <h1>Sendloom</h1>
            <p className="muted">Lists, templates, and sequences in one place.</p>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
          title={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
      <nav className="nav">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <SessionControls collapsed={collapsed} />
    </aside>
  );
}
