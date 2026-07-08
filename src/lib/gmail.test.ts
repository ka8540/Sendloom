import { describe, expect, it } from "vitest";

import { buildGmailDsnCandidateQuery } from "@/lib/gmail";

describe("Gmail DSN candidate search", () => {
  it("searches broad bounce signals across the mailbox, not only sent or unread mail", () => {
    const query = buildGmailDsnCandidateQuery({
      after: new Date("2026-07-08T18:00:00Z"),
      before: new Date("2026-07-08T21:00:00Z")
    });

    expect(query).toContain("from:mailer-daemon");
    expect(query).toContain("from:mailer-daemon@googlemail.com");
    expect(query).toContain("from:postmaster");
    expect(query).toContain('"Mail Delivery Subsystem"');
    expect(query).toContain('"Address not found"');
    expect(query).toContain('"Address rejected"');
    expect(query).toContain('"550 5.1.0"');
    expect(query).toContain('"550 #5.1.0"');
    expect(query).toContain('"550 5.1.1"');
    expect(query).toContain('"user unknown"');
    expect(query).toContain('"recipient rejected"');
    expect(query).toContain('"unable to receive mail"');
    expect(query).toContain('"Delivery Status Notification"');
    expect(query).toContain('"Undelivered Mail Returned to Sender"');
    expect(query).toContain("after:");
    expect(query).toContain("before:");
    expect(query).not.toContain("in:sent");
    expect(query).not.toContain("is:unread");
  });
});
