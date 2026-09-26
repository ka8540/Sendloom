import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TavilySearchError, TavilySearchProvider } from "./tavily-search-provider";

describe("TavilySearchProvider", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
  });

  it("uses the official Search request shape without fake pagination", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      query: "query",
      results: [{ title: "Jane - Engineer at Acme", url: "https://linkedin.com/in/jane", content: "evidence", score: 0.9 }],
      response_time: "1.25",
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
      include_domains: ["linkedin.com/in"],
      include_domains_mode: "restrict"
    });
    expect(body).not.toHaveProperty("page");
    expect(body).not.toHaveProperty("offset");
    expect(body).not.toHaveProperty("cursor");
    expect(response).toMatchObject({ rawResultCount: 1, creditsUsed: 1, responseTimeSeconds: 1.25 });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "TAVILY_REQUEST_COMPLETED",
      status: 200,
      rawResultCount: 1,
      creditsUsed: 1,
      responseTimeSeconds: 1.25
    }));
  });

  it.each([
    [400, "PROVIDER"],
    [422, "PROVIDER"],
    [401, "AUTHENTICATION"],
    [429, "RATE_LIMIT"],
    [432, "USAGE_LIMIT"],
    [433, "USAGE_LIMIT"],
    [500, "PROVIDER"]
  ] as const)("classifies HTTP %i safely", async (status, kind) => {
    const apiKey = `super-private-api-key-${status}`;
    const provider = new TavilySearchProvider({
      apiKey,
      enabled: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        detail: [{ type: "validation_error", input: "private provider body" }]
      }), { status }))
    });
    await expect(provider.search("private search query")).rejects.toMatchObject({
      kind,
      status,
      errorType: "validation_error"
    });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "TAVILY_REQUEST_FAILED",
      status,
      kind,
      errorType: "validation_error"
    }));
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).not.toContain(apiKey);
    expect(logs).not.toContain("private search query");
    expect(logs).not.toContain("private provider body");
  });

  it("retains and logs only bounded safe provider error codes", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        detail: { error: { type: "validation_error", code: "invalid_domain" } }
      }), { status: 400 }))
    });

    await expect(provider.search("private query")).rejects.toMatchObject({
      kind: "PROVIDER",
      status: 400,
      errorType: "validation_error",
      errorCode: "invalid_domain"
    });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "TAVILY_REQUEST_FAILED",
      status: 400,
      kind: "PROVIDER",
      errorType: "validation_error",
      errorCode: "invalid_domain"
    }));
  });

  it("classifies fetch exceptions as network failures without logging secrets or query text", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "super-private-api-key",
      enabled: true,
      fetcher: vi.fn(async () => {
        throw new TypeError("fetch failed for super-private-api-key and private search query");
      })
    });

    await expect(provider.search("private search query")).rejects.toMatchObject({
      kind: "NETWORK",
      status: null
    });
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).toContain(JSON.stringify({
      event: "TAVILY_REQUEST_FAILED",
      status: null,
      kind: "NETWORK"
    }));
    expect(logs).not.toContain("super-private-api-key");
    expect(logs).not.toContain("private search query");
    expect(logs).not.toContain("fetch failed");
  });

  it("classifies an aborted provider timeout without leaking request details", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      timeoutMs: 5_000,
      fetcher: vi.fn(async () => {
        throw new DOMException("private timeout detail", "TimeoutError");
      })
    });

    await expect(provider.search("private timeout query")).rejects.toMatchObject({
      kind: "TIMEOUT",
      status: null
    });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "TAVILY_REQUEST_FAILED",
      status: null,
      kind: "TIMEOUT"
    }));
    expect(info.mock.calls.flat().join(" ")).not.toContain("private timeout query");
  });

  it("rejects malformed successful responses", async () => {
    const provider = new TavilySearchProvider({
      apiKey: "secret",
      enabled: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ results: "invalid" }), { status: 200 }))
    });
    await expect(provider.search("query")).rejects.toEqual(
      new TavilySearchError("MALFORMED_RESPONSE", { status: 200 })
    );
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
