import { describe, expect, it } from "vitest";

import type { PersonNode, ProspectSearchNode } from "@/components/prospects/prospect-graphql";
import {
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  confidenceBadge,
  emailStatusBadge,
  filterPeopleByText,
  formatSearchError,
  formatShowingLabel,
  isEmailCopyable,
  isVerifiedStatus,
  personLocation,
  resolveProspectPageState,
  resolveSelectedSearchView,
  statusBadge
} from "@/components/prospects/prospect-view";

function person(overrides: Partial<PersonNode> = {}): PersonNode {
  return {
    id: "p1",
    fullName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    currentTitle: "Software Engineer",
    normalizedTitle: "software engineer",
    location: "London, United Kingdom",
    country: "United Kingdom",
    state: null,
    city: "London",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    inferredEmail: "ada.lovelace@example.com",
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "first.last",
    emailSource: "PATTERN",
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides
  };
}

function search(overrides: Partial<ProspectSearchNode> = {}): ProspectSearchNode {
  return {
    id: "s1",
    requestedCompany: "Stripe",
    requestedTitles: ["Software Engineer"],
    requestedLocations: ["United States"],
    maxResults: 20,
    status: "READY",
    errorCode: null,
    errorMessage: null,
    peopleCount: 3,
    createdAt: "2026-06-18T00:00:00.000Z",
    completedAt: "2026-06-18T00:01:00.000Z",
    company: {
      id: "c1",
      name: "Stripe, Inc.",
      officialDomain: "stripe.com",
      emailPattern: "first.last",
      patternConfidence: "HIGH",
      peopleCount: 3
    },
    ...overrides
  };
}

describe("email status badges — inferred is never verified", () => {
  it("labels inferred-high as Inferred and not the verified tone", () => {
    const badge = emailStatusBadge("INFERRED_HIGH");
    expect(badge.label).toMatch(/inferred/i);
    expect(badge.label).not.toMatch(/verified/i);
    expect(badge.tone).not.toBe("verified");
  });

  it("labels inferred-medium and inferred-low as inferred (not verified)", () => {
    for (const status of ["INFERRED_MEDIUM", "INFERRED_LOW"] as const) {
      const badge = emailStatusBadge(status);
      expect(badge.label).toMatch(/inferred/i);
      expect(badge.tone).not.toBe("verified");
    }
  });

  it("only uses the verified tone for a real VERIFIED status", () => {
    expect(emailStatusBadge("VERIFIED").tone).toBe("verified");
    expect(isVerifiedStatus("VERIFIED")).toBe(true);
    expect(isVerifiedStatus("INFERRED_HIGH")).toBe(false);
  });

  it("shows Unavailable / Suppressed appropriately", () => {
    expect(emailStatusBadge("UNAVAILABLE").label).toMatch(/unavailable/i);
    expect(emailStatusBadge("UNAVAILABLE").tone).toBe("muted");
    expect(emailStatusBadge("SUPPRESSED").tone).toBe("blocked");
  });

  it("exposes a persistent inferred-not-verified notice", () => {
    expect(INFERRED_EMAIL_NOTICE).toMatch(/inferred/i);
    expect(INFERRED_EMAIL_NOTICE).toMatch(/verified/i);
  });
});

describe("confidence badges", () => {
  it("maps levels without throwing and never marks LOW as verified", () => {
    expect(confidenceBadge("HIGH").label).toBe("High");
    expect(confidenceBadge("LOW").tone).toBe("warning");
    expect(confidenceBadge("UNAVAILABLE").tone).toBe("muted");
  });
});

describe("copy-email visibility", () => {
  it("is copyable when an inferred email is present", () => {
    expect(isEmailCopyable(person({ inferredEmail: "x@y.com", emailStatus: "INFERRED_HIGH" }))).toBe(true);
  });

  it("is NOT copyable for an unavailable / empty email", () => {
    expect(isEmailCopyable(person({ inferredEmail: null, emailStatus: "UNAVAILABLE" }))).toBe(false);
    expect(isEmailCopyable(person({ inferredEmail: "   ", emailStatus: "INFERRED_LOW" }))).toBe(false);
  });
});

describe("external LinkedIn links are hardened", () => {
  it("opens in a new tab with a safe rel", () => {
    expect(EXTERNAL_LINK_TARGET).toBe("_blank");
    expect(EXTERNAL_LINK_REL).toBe("noopener noreferrer");
  });
});

describe("page-level view state", () => {
  it("returns disabled when the feature flag is off", () => {
    expect(resolveProspectPageState({ disabled: true, loading: false, searchCount: 0 })).toBe("disabled");
  });

  it("returns loading only while the first load is in flight", () => {
    expect(resolveProspectPageState({ disabled: false, loading: true, searchCount: 0 })).toBe("loading");
  });

  it("returns empty when there are no searches", () => {
    expect(resolveProspectPageState({ disabled: false, loading: false, searchCount: 0 })).toBe("empty");
  });

  it("returns ready once searches exist", () => {
    expect(resolveProspectPageState({ disabled: false, loading: false, searchCount: 2 })).toBe("ready");
  });
});

describe("selected-search view state", () => {
  it("is 'none' with no selection (no company present)", () => {
    expect(resolveSelectedSearchView(null)).toBe("none");
  });

  it("is 'ready' for a READY search with a company", () => {
    expect(resolveSelectedSearchView(search())).toBe("ready");
  });

  it("is 'processing' for a READY search that has no company yet", () => {
    expect(resolveSelectedSearchView(search({ status: "READY", company: null }))).toBe("processing");
  });

  it("is 'failed' / 'canceled' / 'processing' for those statuses", () => {
    expect(resolveSelectedSearchView(search({ status: "FAILED", company: null }))).toBe("failed");
    expect(resolveSelectedSearchView(search({ status: "CANCELED", company: null }))).toBe("canceled");
    expect(resolveSelectedSearchView(search({ status: "SEARCHING_PEOPLE", company: null }))).toBe("processing");
  });
});

describe("failed-search error formatting is safe", () => {
  it("uses the curated code and message when present", () => {
    const result = formatSearchError({ errorCode: "PROVIDER_TIMEOUT", errorMessage: "The profile search timed out." });
    expect(result.code).toBe("PROVIDER_TIMEOUT");
    expect(result.message).toMatch(/timed out/i);
  });

  it("falls back to a friendly message when none is provided", () => {
    const result = formatSearchError({ errorCode: null, errorMessage: null });
    expect(result.code).toBe("ERROR");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("status badges", () => {
  it("marks READY as verified-tone and FAILED as blocked", () => {
    expect(statusBadge("READY").tone).toBe("verified");
    expect(statusBadge("FAILED").tone).toBe("blocked");
    expect(statusBadge("SEARCHING_PEOPLE").tone).toBe("inferred");
  });
});

describe("formatting helpers", () => {
  it("builds a Showing 1–20 of N label", () => {
    expect(formatShowingLabel({ offset: 0, pageCount: 20, totalCount: 134 })).toBe("Showing 1–20 of 134");
    expect(formatShowingLabel({ offset: 20, pageCount: 14, totalCount: 134 })).toBe("Showing 21–34 of 134");
  });

  it("handles an empty page", () => {
    expect(formatShowingLabel({ offset: 0, pageCount: 0, totalCount: 0 })).toMatch(/no people/i);
  });

  it("composes a location from structured fields with a raw fallback", () => {
    expect(personLocation(person({ city: "Dublin", state: null, country: "Ireland" }))).toBe("Dublin, Ireland");
    expect(personLocation(person({ city: null, state: null, country: null, location: "Remote" }))).toBe("Remote");
    expect(personLocation(person({ city: null, state: null, country: null, location: null }))).toBe("—");
  });

  it("filters people locally by name, title or email", () => {
    const people = [person({ id: "a", fullName: "Ada Lovelace" }), person({ id: "b", fullName: "Alan Turing", inferredEmail: "alan@x.com" })];
    expect(filterPeopleByText(people, "turing").map((p) => p.id)).toEqual(["b"]);
    expect(filterPeopleByText(people, "alan@x").map((p) => p.id)).toEqual(["b"]);
    expect(filterPeopleByText(people, "")).toHaveLength(2);
  });
});
