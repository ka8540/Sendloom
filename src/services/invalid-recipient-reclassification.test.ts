import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory recipient jobs / suppressions; no real database, redis, or Gmail.
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    jobs: [] as Row[],
    suppressions: [] as Row[]
  };
  const calls = {
    syncRunCounts: [] as string[],
    recordSuppression: [] as Row[]
  };
  const prismaMock = {
    recipientJob: {
      findMany: async ({ where, take }: Row) =>
        state.jobs
          .filter((job) => job.status === where.status)
          .slice(0, take ?? 1000)
          .map((job) => ({
            ...job,
            campaignRun: { campaign: { userId: job.userId, senderProfile: { userId: job.userId } } }
          })),
      update: async ({ where, data }: Row) => {
        const job = state.jobs.find((entry) => entry.id === where.id);
        if (job) {
          Object.assign(job, data);
        }
        return job;
      }
    },
    suppression: {
      findMany: async ({ where }: Row) =>
        state.suppressions.filter(
          (row) => where.email.in.includes(row.email) && where.reason.in.includes(row.reason)
        )
    }
  };
  return { state, calls, prismaMock };
});

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));
vi.mock("@/services/campaigns", () => ({
  syncRunCounts: vi.fn(async (runId: string) => {
    h.calls.syncRunCounts.push(runId);
    return {};
  })
}));
vi.mock("@/services/suppressions", () => ({
  recordInvalidRecipientSuppression: vi.fn(async (args: Record<string, unknown>) => {
    h.calls.recordSuppression.push(args);
    return args;
  })
}));

import {
  findInvalidRecipientEvidence,
  reclassifyInvalidRecipientJobs
} from "@/services/invalid-recipient-reclassification";

let jobCounter = 0;
function failedJob(overrides: Record<string, any> = {}) {
  jobCounter += 1;
  return {
    id: `job_${jobCounter}`,
    campaignRunId: overrides.campaignRunId ?? `run_${jobCounter}`,
    recipientEmail: overrides.recipientEmail ?? `person${jobCounter}@example.com`,
    userId: overrides.userId ?? "user-1",
    status: "FAILED",
    lastError: null,
    metadata: null,
    updatedAt: new Date(),
    ...overrides
  };
}

beforeEach(() => {
  h.state.jobs = [];
  h.state.suppressions = [];
  h.calls.syncRunCounts = [];
  h.calls.recordSuppression = [];
});

describe("findInvalidRecipientEvidence", () => {
  it("finds evidence in stored hard-bounce classification metadata", () => {
    expect(
      findInvalidRecipientEvidence({
        metadata: { failureCode: "HARD_BOUNCE_RECIPIENT", failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND" },
        lastError: null
      })
    ).toMatchObject({ failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND", evidenceSource: "bounce-metadata" });
  });

  it("finds evidence in sanitized provider diagnostics", () => {
    expect(
      findInvalidRecipientEvidence({
        metadata: {
          failureCode: "GMAIL_SEND_REJECTED",
          providerErrorMessage: "550-5.1.1 The email account that you tried to reach does not exist"
        },
        lastError: "Gmail rejected this recipient."
      })
    ).toMatchObject({
      failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT",
      enhancedStatusCode: "5.1.1",
      evidenceSource: "provider-diagnostic"
    });
  });

  it("returns null for generic, policy, transient, and system failures", () => {
    for (const job of [
      { metadata: { failureCode: "GMAIL_SEND_REJECTED" }, lastError: "Gmail rejected this recipient." },
      {
        metadata: { failureCode: "GMAIL_SEND_REJECTED", failureCategory: "POLICY_REJECTION" },
        lastError: "Delivery rejected by the receiving server"
      },
      { metadata: { failureCode: "GMAIL_RATE_LIMITED" }, lastError: "Gmail is rate limiting sends right now." },
      { metadata: { failureCode: "GMAIL_TOKEN_EXPIRED" }, lastError: "Reconnect Gmail to continue sending." },
      { metadata: null, lastError: "An attachment could not be read." }
    ]) {
      expect(findInvalidRecipientEvidence(job)).toBeNull();
    }
  });
});

describe("reclassifyInvalidRecipientJobs", () => {
  it("dry-run reports candidates without writing anything", async () => {
    h.state.jobs = [
      failedJob({ metadata: { providerErrorMessage: "550 5.1.1 Address not found" } }),
      failedJob({ lastError: "Could not send Gmail message." })
    ];

    const result = await reclassifyInvalidRecipientJobs({ apply: false });

    expect(result.scanned).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.reclassifiedCount).toBe(0);
    expect(h.state.jobs.every((job) => job.status === "FAILED")).toBe(true);
    expect(h.calls.recordSuppression).toHaveLength(0);
    expect(h.calls.syncRunCounts).toHaveLength(0);
  });

  it("apply reclassifies candidates to SUPPRESSED and records one suppression per address", async () => {
    h.state.jobs = [
      failedJob({
        recipientEmail: "Ghost@Example.com",
        campaignRunId: "run-a",
        metadata: { providerErrorMessage: "550 5.1.1 Address not found" }
      }),
      failedJob({
        recipientEmail: "ghost@example.com",
        campaignRunId: "run-b",
        metadata: { providerErrorMessage: "550 5.1.1 Address not found" }
      }),
      failedJob({ recipientEmail: "fine@example.com", campaignRunId: "run-a", lastError: "Backend Error" })
    ];

    const result = await reclassifyInvalidRecipientJobs({ apply: true });

    expect(result.reclassifiedCount).toBe(2);
    expect(result.suppressionsRecordedCount).toBe(1);
    expect(h.calls.recordSuppression[0]).toMatchObject({
      email: "ghost@example.com",
      failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT"
    });

    const reclassified = h.state.jobs.filter((job) => job.status === "SUPPRESSED");
    expect(reclassified).toHaveLength(2);
    for (const job of reclassified) {
      expect(job.metadata).toMatchObject({
        failureCode: "HARD_BOUNCE_RECIPIENT",
        failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT",
        retryable: false
      });
      expect(job.lastError).toBe("Invalid recipient");
    }
    expect(h.state.jobs.find((job) => job.recipientEmail === "fine@example.com")?.status).toBe("FAILED");
    expect(new Set(h.calls.syncRunCounts)).toEqual(new Set(["run-a", "run-b"]));
  });

  it("apply is idempotent — a second run finds no remaining candidates", async () => {
    h.state.jobs = [failedJob({ metadata: { providerErrorMessage: "550 5.1.1 user unknown" } })];

    await reclassifyInvalidRecipientJobs({ apply: true });
    const second = await reclassifyInvalidRecipientJobs({ apply: true });

    expect(second.candidates).toHaveLength(0);
    expect(second.reclassifiedCount).toBe(0);
    expect(h.calls.recordSuppression).toHaveLength(1);
  });

  it("treats an existing invalid-address suppression as evidence for unexplained FAILED rows", async () => {
    h.state.jobs = [failedJob({ recipientEmail: "gone@example.com", lastError: "Gmail rejected this recipient." })];
    h.state.suppressions = [
      {
        userId: "user-1",
        email: "gone@example.com",
        reason: "HARD_BOUNCE",
        failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND",
        enhancedStatusCode: "5.1.1"
      }
    ];

    const result = await reclassifyInvalidRecipientJobs({ apply: true });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.evidence).toMatchObject({
      failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND",
      evidenceSource: "existing-suppression"
    });
    expect(h.state.jobs[0]?.status).toBe("SUPPRESSED");
  });

  it("contains no company- or domain-specific special cases", async () => {
    const { readFile } = await import("node:fs/promises");
    const sources = await Promise.all([
      readFile("src/services/invalid-recipient-reclassification.ts", "utf8"),
      readFile("src/lib/gmail-errors.ts", "utf8"),
      readFile("src/lib/retry-policy.ts", "utf8")
    ]);
    for (const source of sources) {
      // Detection must be signature-based only — never keyed to a company,
      // brand, or recipient domain.
      expect(source).not.toMatch(/intuit|@[a-z0-9-]+\.(com|net|org)\b/i);
    }
  });
});
