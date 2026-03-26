import { describe, expect, it } from "vitest";

import { analyzeSpam } from "@/lib/spam-analysis";

describe("analyzeSpam", () => {
  it("flags high-risk promotional subjects", async () => {
    const result = await analyzeSpam("subject", "FREE LIMITED TIME GUARANTEE!!! Click here now");

    expect(result.risk).toBe("High");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("keeps relevant, restrained copy in the low-risk range", async () => {
    const result = await analyzeSpam(
      "body",
      "<p>Hi {{name}},</p><p>I noticed {{company}} is hiring platform engineers and thought I’d share a quick idea that may help with the migration work.</p>"
    );

    expect(result.risk).toBe("Low");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
