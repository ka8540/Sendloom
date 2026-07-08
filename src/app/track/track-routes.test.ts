import { beforeEach, describe, expect, it, vi } from "vitest";

// Engagement tracking must only ever ADVANCE a delivered message
// (SENT → OPENED → CLICKED). A pixel or link fetched from a quoted bounce
// report (Gmail's image proxy loads it when the sender views the bounce) or by
// a scanner must never resurrect a terminal outcome such as SUPPRESSED — that
// is exactly how hard-bounced recipients ended up counted as "Opened".

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { jobs: [] as Row[] };
  const matches = (row: Row, where: Row) => {
    if (row.id !== where.id) return false;
    if (typeof where.status === "string") return row.status === where.status;
    if (where.status?.in) return where.status.in.includes(row.status);
    return true;
  };
  const prismaMock = {
    recipientJob: {
      update: async ({ where, data }: Row) => {
        const row = state.jobs.find((entry) => entry.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: Row) => {
        let count = 0;
        for (const row of state.jobs) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }
    }
  };
  return { state, prismaMock };
});

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));
vi.mock("@/lib/env", () => ({ env: { APP_BASE_URL: "https://app.example.test" } }));
vi.mock("@/lib/tracking", () => {
  class InvalidTrackingTokenError extends Error {}
  return {
    InvalidTrackingTokenError,
    transparentPixel: () => new Uint8Array([71, 73, 70]),
    verifyTrackingToken: (token: string) => {
      if (token.startsWith("bad")) throw new InvalidTrackingTokenError("invalid");
      return { jobId: token, target: "/thanks" };
    }
  };
});

import { GET as openRoute } from "@/app/track/open/[token]/route";
import { GET as clickRoute } from "@/app/track/click/[token]/route";

function job(id: string, status: string) {
  const row = { id, status };
  h.state.jobs.push(row);
  return row;
}

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  h.state.jobs.length = 0;
});

describe("open tracking", () => {
  it("advances a delivered message to OPENED", async () => {
    const row = job("job-sent", "SENT");
    const response = await openRoute(new Request("https://app.example.test"), params("job-sent"));
    expect(response.status).toBe(200);
    expect(row.status).toBe("OPENED");
  });

  it.each(["SUPPRESSED", "FAILED", "INVALID", "BOUNCED", "PENDING", "RETRYING"])(
    "never resurrects a %s recipient into an engagement state",
    async (status) => {
      const row = job("job-terminal", status);
      const response = await openRoute(new Request("https://app.example.test"), params("job-terminal"));
      expect(response.status).toBe(200);
      expect(row.status).toBe(status);
    }
  );
});

describe("click tracking", () => {
  it("advances SENT and OPENED messages to CLICKED", async () => {
    const sent = job("job-a", "SENT");
    const opened = job("job-b", "OPENED");
    await clickRoute(new Request("https://app.example.test"), params("job-a"));
    await clickRoute(new Request("https://app.example.test"), params("job-b"));
    expect(sent.status).toBe("CLICKED");
    expect(opened.status).toBe("CLICKED");
  });

  it("never resurrects a suppressed recipient into CLICKED", async () => {
    const row = job("job-suppressed", "SUPPRESSED");
    const response = await clickRoute(new Request("https://app.example.test"), params("job-suppressed"));
    // The redirect still happens (the human clicked a link) — only the
    // recipient's recorded outcome stays truthful.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(row.status).toBe("SUPPRESSED");
  });
});
