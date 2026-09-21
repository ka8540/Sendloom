import { describe, expect, it } from "vitest";

import { canonicalizeLinkedInProfileUrl, resolveLinkedInProfileUrl } from "./linkedin-profile-url";

describe("LinkedIn public profile identity", () => {
  it("canonicalizes locale hosts and strips tracking parameters", () => {
    expect(canonicalizeLinkedInProfileUrl("https://fr.linkedin.com/in/Jane-Doe/?trk=public"))
      .toEqual({ linkedinUrl: "https://www.linkedin.com/in/jane-doe", sourceProfileId: "jane-doe" });
  });

  it("accepts decoded Google result redirects", () => {
    expect(resolveLinkedInProfileUrl("https://www.google.com/url?q=https%3A%2F%2Flinkedin.com%2Fin%2FJane-Doe"))
      .toMatchObject({ ok: true, source: "REDIRECT" });
  });

  it.each([
    "https://linkedin.com/company/sendloom",
    "https://linkedin.com/jobs/view/1",
    "https://linkedin.com/posts/jane_1",
    "https://linkedin.com/search/results/people",
    "https://example.com/in/jane"
  ])("rejects non-person URL %s", (url) => {
    expect(resolveLinkedInProfileUrl(url).ok).toBe(false);
  });

  it("rejects opaque and malformed Google redirects", () => {
    expect(resolveLinkedInProfileUrl("https://google.com/url?ved=opaque")).toEqual({ ok: false, reason: "redirectDecodeFailed" });
  });
});
