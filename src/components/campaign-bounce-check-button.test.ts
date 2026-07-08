import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The button is a client component; per the repo's node-only test convention
// its user-facing contract is asserted at the source level: required copy,
// the API it calls, loading/disabled handling, and that the sequence detail
// page keeps Refresh validation as a separate action.

const BUTTON = readFileSync("src/components/campaign-bounce-check-button.tsx", "utf8");
const DETAIL_PAGE = readFileSync("src/app/(app)/campaigns/[id]/page.tsx", "utf8");

describe("Check bounces button", () => {
  it("calls the sequence-scoped sync-bounces API with POST", () => {
    expect(BUTTON).toContain("/sync-bounces");
    expect(BUTTON).toMatch(/method:\s*"POST"/);
  });

  it("renders the required action and loading copy", () => {
    expect(BUTTON).toContain("Check bounces");
    expect(BUTTON).toContain("Checking bounces…");
  });

  it("shows the success, no-new-bounces, disconnected, and failure messages", () => {
    expect(BUTTON).toContain("invalid address");
    expect(BUTTON).toContain("marked as skipped");
    expect(BUTTON).toContain("No new bounces found.");
    expect(BUTTON).toContain("Reconnect Gmail to check bounces.");
    expect(BUTTON).toContain("Couldn't check bounces. Please try again.");
  });

  it("disables duplicate clicks while running and refreshes sequence data after the check", () => {
    expect(BUTTON).toMatch(/disabled=\{pending\}/);
    expect(BUTTON).toContain("router.refresh()");
  });

  it("never uses native browser dialogs", () => {
    expect(BUTTON).not.toMatch(/window\.(alert|confirm)|(^|[^.\w])alert\(|([^.\w])confirm\(/);
  });
});

describe("sequence detail controls", () => {
  it("renders Check bounces alongside the existing controls", () => {
    expect(DETAIL_PAGE).toContain("<CampaignBounceCheckButton");
    // Placed in the secondary action row, right after Refresh validation.
    const row = DETAIL_PAGE.slice(
      DETAIL_PAGE.indexOf("actionSecondaryRow"),
      DETAIL_PAGE.indexOf("actionPrimaryRow")
    );
    expect(row).toContain("validationButtonLabel");
    expect(row).toContain("CampaignBounceCheckButton");
    expect(row.indexOf("validationButtonLabel")).toBeLessThan(row.indexOf("CampaignBounceCheckButton"));
  });

  it("keeps Refresh validation as a separate, unreplaced action", () => {
    expect(DETAIL_PAGE).toMatch(/validationButtonLabel\s*=\s*campaign\.lastValidatedAt\s*\?\s*"Refresh validation"/);
    expect(DETAIL_PAGE).toContain("validate.bind(null, campaign.id)");
  });

  it("is not gated on run status — completed sequences can still check bounces", () => {
    const usage = DETAIL_PAGE.slice(
      DETAIL_PAGE.indexOf("<CampaignBounceCheckButton"),
      DETAIL_PAGE.indexOf("/>", DETAIL_PAGE.indexOf("<CampaignBounceCheckButton"))
    );
    expect(usage).not.toContain("isActiveRun");
    expect(usage).not.toContain("DONE_STATUSES");
  });
});
