import { describe, expect, it } from "vitest";

import { createFakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { protectFormatChangeSuppressions } from "@/services/prospects/discover-person-format-change";
import type { ProspectPersonEmailInput } from "@/services/prospects/prospect-person-email";

function person(email: string, overrides: Record<string, unknown> = {}): ProspectPersonEmailInput {
  return {
    firstName: "Tommy",
    lastName: "Kumar",
    inferredEmail: email,
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "first",
    emailSource: "PATTERN",
    ...overrides
  } as ProspectPersonEmailInput;
}

describe("company format-change suppression policy", () => {
  it.each(["HARD_BOUNCE", "INVALID_EMAIL"])(
    "lets a new PATTERN candidate replace an old %s address without deleting history",
    async (reason) => {
      const prisma = createFakePrisma();
      prisma._state.suppressions.push({
        id: "suppression_old",
        userId: "user_A",
        email: "tommy@flexport.com",
        reason,
        source: "test"
      });

      const result = await protectFormatChangeSuppressions(
        prisma as never,
        "user_A",
        [person("tommy@flexport.com", { emailStatus: "INVALID" })],
        [person("tkumar@flexport.com", { emailPattern: "flast" })]
      );

      expect(result.people[0]).toMatchObject({
        inferredEmail: "tkumar@flexport.com",
        emailStatus: "INFERRED_HIGH",
        emailPattern: "flast"
      });
      expect(prisma._state.suppressions).toEqual([
        expect.objectContaining({ email: "tommy@flexport.com", reason })
      ]);
      expect(result.stats).toMatchObject({ peopleEligible: 1, peopleRegenerated: 1, emailsChanged: 1, becameUsable: 1 });
    }
  );

  it("persists the new candidate but leaves a suppression overlay for that exact new address at read time", async () => {
    const prisma = createFakePrisma();
    prisma._state.suppressions.push({
      id: "suppression_new",
      userId: "user_A",
      email: "tkumar@flexport.com",
      reason: "HARD_BOUNCE",
      source: "test"
    });

    const result = await protectFormatChangeSuppressions(
      prisma as never,
      "user_A",
      [person("tommy@flexport.com")],
      [person("tkumar@flexport.com", { emailPattern: "flast" })]
    );

    expect(result.people[0].inferredEmail).toBe("tkumar@flexport.com");
    expect(result.people[0].emailStatus).toBe("INFERRED_HIGH");
    expect(result.stats.remainedInvalid).toBe(1);
  });

  it.each([
    ["UNSUBSCRIBED", "UNSUBSCRIBED", "protectedUnsubscribed"],
    ["COMPLAINT", "SUPPRESSED", "protectedComplaint"],
    ["MANUAL_BLOCK", "SUPPRESSED", "protectedManualBlock"]
  ])("does not route around %s when the company format changes", async (reason, status, counter) => {
    const prisma = createFakePrisma();
    prisma._state.suppressions.push({
      id: `suppression_${reason}`,
      userId: "user_A",
      email: "tommy@flexport.com",
      reason,
      source: "test"
    });

    const result = await protectFormatChangeSuppressions(
      prisma as never,
      "user_A",
      [person("tommy@flexport.com")],
      [person("tkumar@flexport.com", { emailPattern: "flast" })]
    );

    expect(result.people[0]).toMatchObject({ inferredEmail: "tommy@flexport.com", emailStatus: status });
    expect(result.stats[counter as keyof typeof result.stats]).toBe(1);
    expect(result.stats.peopleRegenerated).toBe(0);
  });
});
