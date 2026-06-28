import { describe, expect, it } from "vitest";
import {
  Building2,
  FilePenLine,
  FileSpreadsheet,
  MailSearch,
  Search,
  SendHorizontal,
  ShieldBan,
  TriangleAlert,
  UserRoundPlus,
  UsersRound
} from "lucide-react";

import { getActivityIcon, getActivityTone } from "@/components/dashboard/activity-icons";
import type { ActivityItem } from "@/components/dashboard/types";

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "x",
    href: "/prospects",
    title: "Title",
    description: "Description",
    timeLabel: "now",
    timeValue: new Date().toISOString(),
    kind: "discover",
    tone: "muted",
    ...overrides
  };
}

describe("activity icons — new Discover/Finder event types", () => {
  it("uses the Users icon for Discover ready (#feed-4)", () => {
    expect(getActivityIcon(item({ eventType: "discover_search_ready", tone: "success" }))).toBe(UsersRound);
  });

  it("uses the Search icon for Discover search created", () => {
    expect(getActivityIcon(item({ eventType: "discover_search_created" }))).toBe(Search);
  });

  it("uses the User Plus icon for Discover people added (#feed-5)", () => {
    expect(getActivityIcon(item({ eventType: "discover_people_added" }))).toBe(UserRoundPlus);
  });

  it("uses the Spreadsheet icon for Discover export (#feed-6)", () => {
    expect(getActivityIcon(item({ eventType: "discover_results_exported" }))).toBe(FileSpreadsheet);
  });

  it("uses the Mail Search icon for Finder email lookup (#feed-8)", () => {
    expect(getActivityIcon(item({ kind: "finder", eventType: "finder_email_found" }))).toBe(MailSearch);
  });

  it("uses the Building icon for Finder domain search (#feed-9)", () => {
    expect(getActivityIcon(item({ kind: "finder", eventType: "finder_domain_search" }))).toBe(Building2);
  });

  it("uses the warning icon and warning tone for failure events (#feed-10)", () => {
    const failed = item({
      eventType: "discover_search_failed",
      tone: "warning",
      title: "Stripe search needs attention"
    });
    expect(getActivityIcon(failed)).toBe(TriangleAlert);
    expect(getActivityTone(failed)).toBe("warning");
  });

  it("gives each new event type a distinct glyph (no single shared icon)", () => {
    const icons = [
      getActivityIcon(item({ eventType: "discover_search_created" })),
      getActivityIcon(item({ eventType: "discover_search_ready" })),
      getActivityIcon(item({ eventType: "discover_people_added" })),
      getActivityIcon(item({ eventType: "discover_results_exported" })),
      getActivityIcon(item({ kind: "finder", eventType: "finder_email_found" })),
      getActivityIcon(item({ kind: "finder", eventType: "finder_domain_search" }))
    ];
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("activity icons — existing rows still map unchanged (#feed-15 regression)", () => {
  it("keeps the import glyph for import rows", () => {
    expect(getActivityIcon(item({ kind: "import", eventType: undefined, title: "list.csv is ready" }))).toBe(FileSpreadsheet);
  });

  it("keeps the template glyph for template rows", () => {
    expect(getActivityIcon(item({ kind: "template", eventType: undefined, title: "Welcome updated" }))).toBe(FilePenLine);
  });

  it("keeps the suppression glyph for suppression rows", () => {
    expect(getActivityIcon(item({ kind: "suppression", eventType: undefined, title: "Unsubscribe added" }))).toBe(ShieldBan);
  });

  it("keeps the send glyph for an active run row", () => {
    expect(getActivityIcon(item({ kind: "run", eventType: undefined, title: "Camp is sending", description: "sending" }))).toBe(
      SendHorizontal
    );
  });

  it("treats an issue-bearing run as a failure (warning icon)", () => {
    expect(
      getActivityIcon(item({ kind: "run", eventType: undefined, title: "Camp updated", description: "5 sent, 3 issues across 8 recipients" }))
    ).toBe(TriangleAlert);
  });

  it("keeps a clean run row (0 issues) off the failure path", () => {
    const clean = item({ kind: "run", eventType: undefined, title: "Camp updated", description: "20 sent, 0 issues across 20 recipients", tone: "success" });
    expect(getActivityIcon(clean)).not.toBe(TriangleAlert);
    expect(getActivityTone(clean)).toBe("success");
  });
});
