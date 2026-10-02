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
});
