import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/graphql/route";

// PROSPECT_GRAPH_ENABLED defaults to false (and is not set in the test env), so
// the endpoint must reject every request before any resolver/provider runs.
describe("GraphQL route feature flag (#28)", () => {
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
