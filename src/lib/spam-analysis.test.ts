import { describe, expect, it } from "vitest";

import { analyzeSpam } from "@/lib/spam-analysis";

describe("analyzeSpam", () => {
  it("flags high-risk promotional subjects", async () => {
    const result = await analyzeSpam("FREE LIMITED TIME GUARANTEE!!! Click here now", "<p>Hello there.</p>");

    expect(result.subjectRisk).toBe("High");
    expect(result.subjectScore).toBeGreaterThanOrEqual(70);
  });

  it("keeps relevant, restrained copy in the low-risk range", async () => {
    const result = await analyzeSpam(
      "Quick question about your platform team",
      "<p>Hi {{name}},</p><p>I noticed {{company}} is hiring platform engineers and thought I’d share a quick idea that may help with the migration work.</p>"
    );

    expect(result.subjectRisk).toBe("Low");
    expect(result.bodyRisk).toBe("Low");
    expect(result.bodyScore).toBeLessThan(40);
  });
});
