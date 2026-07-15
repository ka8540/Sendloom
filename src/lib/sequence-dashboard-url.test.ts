import { describe, expect, it } from "vitest";

import {
  buildSequenceDashboardReturnTo,
  buildSequenceDetailHref,
  normalizeSequenceDashboardSearchParams,
  readSequenceDashboardUrlState,
  updateSequenceDashboardSearchParams
} from "@/lib/sequence-dashboard-url";

const SENDERS = ["kush.ahir2024@gmail.com", "outreach@sendloom.net"];

describe("sequence dashboard URL state", () => {
  it("restores status, sender, search, and page from search params", () => {
    const params = new URLSearchParams({
      status: "needs-attention",
      sender: "kush.ahir2024@gmail.com",
      q: "amd",
      page: "4"
    });

    expect(readSequenceDashboardUrlState(params, SENDERS)).toEqual({
      filter: "attention",
      sender: "kush.ahir2024@gmail.com",
      query: "amd",
      page: 4
    });
  });

  it("resets only page when a filter changes and preserves the other filters", () => {
    const params = new URLSearchParams(
      "status=completed&sender=outreach%40sendloom.net&q=founder&page=3"
    );
    const next = updateSequenceDashboardSearchParams(params, {
      filter: "attention",
      page: 1
    });

    expect(next.get("status")).toBe("needs-attention");
    expect(next.get("page")).toBeNull();
    expect(next.get("sender")).toBe("outreach@sendloom.net");
    expect(next.get("q")).toBe("founder");
  });

  it("changes only page during pagination", () => {
    const params = new URLSearchParams(
      "status=paused&sender=kush.ahir2024%40gmail.com&q=april&page=2"
    );
    const next = updateSequenceDashboardSearchParams(params, { page: 4 });

    expect(next.toString()).toContain("status=paused");
    expect(next.toString()).toContain("sender=kush.ahir2024%40gmail.com");
    expect(next.toString()).toContain("q=april");
    expect(next.get("page")).toBe("4");
  });

  it("clears only the requested filter param", () => {
    const params = new URLSearchParams(
      "status=scheduled&sender=kush.ahir2024%40gmail.com&q=april&page=2"
    );
    const next = updateSequenceDashboardSearchParams(params, { query: "", page: 1 });

    expect(next.get("q")).toBeNull();
    expect(next.get("page")).toBeNull();
    expect(next.get("status")).toBe("scheduled");
    expect(next.get("sender")).toBe("kush.ahir2024@gmail.com");
  });

  it("normalizes invalid values and an out-of-range page without dropping unrelated params", () => {
    const current = new URLSearchParams(
      "status=unknown&sender=missing%40example.com&q=amd&page=99&gmail=connected"
    );
    const state = readSequenceDashboardUrlState(current, SENDERS);
    const normalized = normalizeSequenceDashboardSearchParams(current, state, 4);

    expect(normalized.get("status")).toBeNull();
    expect(normalized.get("sender")).toBeNull();
    expect(normalized.get("q")).toBe("amd");
    expect(normalized.get("page")).toBe("4");
    expect(normalized.get("gmail")).toBe("connected");
  });

  it("builds a detail link carrying the exact filtered dashboard URL", () => {
    const params = new URLSearchParams(
      "status=needs-attention&page=4&q=amd&sender=kush.ahir2024%40gmail.com"
    );
    const returnTo = buildSequenceDashboardReturnTo("/campaigns", params);
    const href = buildSequenceDetailHref("seq/with spaces", returnTo);

    expect(returnTo).toBe(
      "/campaigns?status=needs-attention&page=4&q=amd&sender=kush.ahir2024%40gmail.com"
    );
    expect(href).toBe(
      "/campaigns/seq%2Fwith%20spaces?returnTo=%2Fcampaigns%3Fstatus%3Dneeds-attention%26page%3D4%26q%3Damd%26sender%3Dkush.ahir2024%2540gmail.com"
    );
  });
});
