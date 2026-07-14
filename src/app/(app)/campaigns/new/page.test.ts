import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CREATE_PAGE = readFileSync("src/app/(app)/campaigns/new/page.tsx", "utf8");
const CREATE_PAGE_CSS = readFileSync("src/app/(app)/campaigns/new/page.module.css", "utf8");
const BACK_BUTTON = readFileSync("src/components/back-button.tsx", "utf8");
const BOUNCE_STATUS = readFileSync("src/components/senders/bounce-monitoring-status.tsx", "utf8");

describe("Create Sequence back control", () => {
  it("does not render a second visible Back to sequences control", () => {
    expect(CREATE_PAGE).not.toContain("Back to sequences");
    expect(CREATE_PAGE).not.toContain("styles.backLink");
  });

  it("uses the icon-only app-shell back button for the sequences dashboard", () => {
    expect(BACK_BUTTON).toContain('pathname === "/campaigns/new"');
    expect(BACK_BUTTON).toContain('pathname === "/sequences/new"');
    expect(BACK_BUTTON).toContain('"Back to sequences"');
    expect(BACK_BUTTON).toContain('router.push("/sequences")');
    expect(BACK_BUTTON).toContain("aria-label={resolvedLabel}");
    expect(BACK_BUTTON).toContain('<ArrowLeft aria-hidden="true" />');
  });
});

describe("Create Sequence sender panel", () => {
  it("renders the Gmail card and keeps its existing actions", () => {
    expect(CREATE_PAGE).toContain('className={styles.senderPanel} aria-label="Send from Gmail"');
    expect(CREATE_PAGE).toContain("Connect another Gmail");
    expect(CREATE_PAGE).toContain("<BounceMonitoringStatus");
    expect(BOUNCE_STATUS).toContain("Sync recent delivery failures");
  });

  it("does not make the sender panel sticky or fixed", () => {
    const senderPanelRule = CREATE_PAGE_CSS.slice(
      CREATE_PAGE_CSS.indexOf("/* The sender panel"),
      CREATE_PAGE_CSS.indexOf(".panelHeading")
    );

    expect(senderPanelRule).toContain("align-self: start;");
    expect(senderPanelRule).not.toMatch(/position:\s*(?:sticky|fixed)/);
    expect(senderPanelRule).not.toMatch(/\btop\s*:/);
    expect(CREATE_PAGE_CSS).not.toMatch(/^\.senderPanel \{[^}]*position:\s*(?:sticky|fixed)/ms);
  });
});
