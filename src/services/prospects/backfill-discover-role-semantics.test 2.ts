import { describe, expect, it, vi } from "vitest";

import { parseBackfillArgs, runBackfillPlan } from "../../../scripts/backfill-discover-role-semantics";

describe("Discover role semantic backfill", () => {
  it("defaults to dry run and performs no writes", async () => {
    const persistBatch = vi.fn(async () => ({ created: 1, failed: false }));
    const stats = await runBackfillPlan({
      titles: [" Software Engineer ", "software engineer", "iOS Engineer", ""],
      existingTitles: new Set(["ios engineer"]),
      invalidOrEmptyTitleCount: 2,
      options: parseBackfillArgs([]),
      persistBatch
    });

    expect(stats).toMatchObject({
      distinctTitleCount: 2,
      alreadyEmbeddedCount: 1,
      missingSemanticCount: 1,
      invalidOrEmptyTitleCount: 2,
      estimatedEmbeddingBatches: 1,
      embeddedCount: 0
    });
    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("applies only missing titles in bounded batches and is idempotent", async () => {
    const stored = new Set<string>(["ios engineer"]);
    const persistBatch = vi.fn(async (titles: readonly string[]) => {
      for (const title of titles) stored.add(title);
      return { created: titles.length, failed: false };
    });
    const options = parseBackfillArgs(["--apply", "--batch-size", "1"]);
    const first = await runBackfillPlan({
      titles: ["Software Engineer", "iOS Engineer", "Recruiter"],
      existingTitles: stored,
      invalidOrEmptyTitleCount: 0,
      options,
      persistBatch
    });
    const second = await runBackfillPlan({
      titles: ["Software Engineer", "iOS Engineer", "Recruiter"],
      existingTitles: stored,
      invalidOrEmptyTitleCount: 0,
      options,
      persistBatch
    });

    expect(first.embeddedCount).toBe(2);
    expect(persistBatch).toHaveBeenCalledTimes(2);
    expect(second.missingSemanticCount).toBe(0);
  });
});
