import { describe, expect, it } from "vitest";
import { renderDeletionEmail } from "./account-deletion-email";

describe("Sendloom deletion email content", () => {
  it.each([
    ["ACCOUNT_DELETED", "Sorry to see you go 💚"],
    ["REQUEST_RECEIVED", "We've received your deletion request"],
    ["FULL_DELETION_COMPLETE", "Your Sendloom deletion is complete"],
  ] as const)("renders branded HTML and text for %s", (kind, subject) => {
    const message = renderDeletionEmail(kind);
    expect(message.subject).toBe(subject);
    expect(message.text).toContain("Sendloom");
    expect(message.html).toContain('lang="en"');
    expect(message.html).toContain("The Sendloom Team");
    expect(message.html).not.toMatch(/passwordHash|oauthRefreshToken|sessionExpiresAt/);
  });

  it("keeps return and pending-request copy consistent with account rules", () => {
    expect(renderDeletionEmail("ACCOUNT_DELETED").text).toContain("no security or enforcement restriction applies");
    expect(renderDeletionEmail("REQUEST_RECEIVED").text).toContain("cancel this request while it is still pending review");
    expect(renderDeletionEmail("FULL_DELETION_COMPLETE").text).toContain("eligibility rules");
  });
});
