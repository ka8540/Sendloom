import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("/api/health", () => {
  it("returns only a minimal status payload (no config disclosure)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });
});
