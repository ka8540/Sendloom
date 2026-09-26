import { describe, expect, it, vi } from "vitest";

import { TavilySearchError, TavilySearchProvider } from "./tavily-search-provider";

describe("TavilySearchProvider", () => {
  it("uses the official Search request shape without fake pagination", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      query: "query",
      results: [{ title: "Jane - Engineer at Acme", url: "https://linkedin.com/in/jane", content: "evidence", score: 0.9 }],
      response_time: 1.25,
      usage: { credits: 1 }
    }), { status: 200 }));
    const provider = new TavilySearchProvider({ apiKey: "server-secret", fetcher, enabled: true });

    const response = await provider.search("query");
    const [, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(fetcher).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({ method: "POST" }));
    expect(init?.headers).toMatchObject({ Authorization: "Bearer server-secret" });
    expect(body).toMatchObject({
      query: "query",
      topic: "general",
      search_depth: "basic",
      max_results: 20,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_domains: ["linkedin.com"],
      include_domains_mode: "restrict"
    });
    expect(body).not.toHaveProperty("page");
    expect(body).not.toHaveProperty("offset");
    expect(body).not.toHaveProperty("cursor");
    expect(response).toMatchObject({ rawResultCount: 1, creditsUsed: 1, responseTimeSeconds: 1.25 });
  });

  it.each([
    [401, "AUTHENTICATION"],
    [429, "RATE_LIMIT"],
    [432, "USAGE_LIMIT"],
    [433, "USAGE_LIMIT"],
    [500, "PROVIDER"]
  ] as const)("classifies HTTP %i safely", async (status, kind) => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      fetcher: vi.fn(async () => new Response("private provider body", { status }))
    });
    await expect(provider.search("query")).rejects.toMatchObject({ kind });
  });

  it("rejects malformed successful responses", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ results: "invalid" }), { status: 200 }))
    });
    await expect(provider.search("query")).rejects.toEqual(new TavilySearchError("MALFORMED_RESPONSE"));
  });

  it("does not advance on a non-empty result array whose rows are all malformed", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ query: "query", results: [{}] }), { status: 200 }))
    });
    await expect(provider.search("query")).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
});
