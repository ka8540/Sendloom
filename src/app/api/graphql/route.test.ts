import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/graphql/route";

// The endpoint must reject every request before any resolver/provider runs when
// the feature is off. env.ts loads .env/.env.local via @next/env at import, so a
// developer who enabled PROSPECT_GRAPH_ENABLED locally (e.g. to use /prospects)
// would otherwise see the route try to handle the request. Force the flag off so
// this disabled-path assertion stays deterministic regardless of local .env.
describe("GraphQL route feature flag (#28)", () => {
  const originalFlag = process.env.PROSPECT_GRAPH_ENABLED;

  beforeAll(() => {
    process.env.PROSPECT_GRAPH_ENABLED = "false";
  });

  afterAll(() => {
    if (originalFlag === undefined) {
      delete process.env.PROSPECT_GRAPH_ENABLED;
    } else {
      process.env.PROSPECT_GRAPH_ENABLED = originalFlag;
    }
  });

  it("returns 404 for GET when the feature is disabled", async () => {
    const response = await GET(new Request("http://localhost/api/graphql?query=%7B__typename%7D"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/not enabled/i);
  });

  it("returns 404 for POST when the feature is disabled", async () => {
    const response = await POST(
      new Request("http://localhost/api/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ __typename }" })
      })
    );
    expect(response.status).toBe(404);
  });
});
