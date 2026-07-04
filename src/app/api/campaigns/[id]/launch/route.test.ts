import { beforeEach, describe, expect, it, vi } from "vitest";

const { launchCampaignMock, processPendingCampaignWorkMock, requireApiUserMock, rateLimitMock, recordAuditEventMock } =
  vi.hoisted(() => ({
    launchCampaignMock: vi.fn(),
    processPendingCampaignWorkMock: vi.fn(),
    requireApiUserMock: vi.fn(),
    rateLimitMock: vi.fn(),
    recordAuditEventMock: vi.fn()
  }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: requireApiUserMock
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: recordAuditEventMock
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response(null, { status: 429 })
}));

// Keep the real structured error classes so the route's `instanceof` checks behave as in
// production, while stubbing the heavy launch implementation.
vi.mock("@/services/campaigns", () => {
  class PastScheduleConfirmationRequiredError extends Error {
    constructor() {
      super("This sequence was originally scheduled for a time that has already passed.");
      this.name = "PastScheduleConfirmationRequiredError";
    }
  }
  class CampaignLaunchBlockedError extends Error {
    report: unknown;
    constructor(report: unknown) {
      super("Fix validation blockers before launching this sequence.");
      this.name = "CampaignLaunchBlockedError";
      this.report = report;
    }
  }

  return {
    launchCampaign: launchCampaignMock,
    processPendingCampaignWork: processPendingCampaignWorkMock,
    PastScheduleConfirmationRequiredError,
    CampaignLaunchBlockedError
  };
});

vi.mock("@/services/sequence-limits", () => {
  class SequenceConcurrencyLimitError extends Error {
    code = "SEQUENCE_CONCURRENCY_LIMIT_REACHED";
    activeCount: number;
    constructor(activeCount: number) {
      super("All sequence slots are busy.");
      this.activeCount = activeCount;
    }
  }
  return { SequenceConcurrencyLimitError };
});

import { PAST_SCHEDULE_CONFIRMATION_CODE } from "@/lib/campaign-scheduling";
import type { CampaignValidationReport } from "@/lib/types";
import { CampaignLaunchBlockedError, PastScheduleConfirmationRequiredError } from "@/services/campaigns";
import { SequenceConcurrencyLimitError } from "@/services/sequence-limits";

import { POST } from "./route";

function makeRequest(body?: unknown) {
  return new Request("https://app.example.com/api/campaigns/seq-1/launch", {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {})
  });
}

const context = { params: Promise.resolve({ id: "seq-1" }) };

// The route inherits `Response | undefined` from requireApiUser's typing; it always
// returns a Response at runtime, so assert that and narrow for the assertions below.
async function callPost(body?: unknown) {
  const res = await POST(makeRequest(body), context);
  if (!res) {
    throw new Error("Expected the launch route to return a response.");
  }
  return res;
}

const emptyReport: CampaignValidationReport = {
  validRecipients: 0,
  invalidRecipients: 0,
  suppressedRecipients: 0,
  duplicateRecipients: 0,
  estimatedDurationMinutes: 0,
  issues: [],
  checks: []
};

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUserMock.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
  rateLimitMock.mockResolvedValue({ allowed: true });
});

describe("POST /api/campaigns/[id]/launch", () => {
  it("returns the confirmation-required code for a past schedule-once relaunch", async () => {
    launchCampaignMock.mockRejectedValueOnce(new PastScheduleConfirmationRequiredError());

    const res = await callPost();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe(PAST_SCHEDULE_CONFIRMATION_CODE);
    expect(launchCampaignMock).toHaveBeenCalledWith("seq-1", "user-1", { convertPastScheduleToImmediate: false });
    expect(processPendingCampaignWorkMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("passes the conversion flag through when the client confirms", async () => {
    launchCampaignMock.mockResolvedValueOnce({ id: "run-1", totalRecipients: 3 });

    const res = await callPost({ convertPastScheduleToImmediate: true });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ id: "run-1" });
    expect(launchCampaignMock).toHaveBeenCalledWith("seq-1", "user-1", { convertPastScheduleToImmediate: true });
    expect(recordAuditEventMock).toHaveBeenCalledOnce();
  });

  it("defaults the conversion flag to false when no body is sent", async () => {
    launchCampaignMock.mockResolvedValueOnce({ id: "run-2", totalRecipients: 1 });

    const res = await callPost();

    expect(res.status).toBe(200);
    expect(launchCampaignMock).toHaveBeenCalledWith("seq-1", "user-1", { convertPastScheduleToImmediate: false });
  });

  it("still surfaces other validation blockers as a 409 with the validation report", async () => {
    launchCampaignMock.mockRejectedValueOnce(new CampaignLaunchBlockedError(emptyReport));

    const res = await callPost();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBeUndefined();
    expect(json.validation).toMatchObject({ validRecipients: 0, issues: [] });
  });

  it("returns the structured concurrency code without starting work", async () => {
    launchCampaignMock.mockRejectedValueOnce(new SequenceConcurrencyLimitError(10));

    const res = await callPost();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("SEQUENCE_CONCURRENCY_LIMIT_REACHED");
    expect(processPendingCampaignWorkMock).not.toHaveBeenCalled();
  });
});
