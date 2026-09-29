import { afterEach, describe, expect, it, vi } from "vitest";
import { FirecrawlSearchProvider, FirecrawlSearchError, firecrawlFailureEvent } from "./firecrawl-search-provider";

const row = { url: "https://linkedin.com/in/jane", title: "Jane Doe", description: "Software Engineer at Acme", position: 1 };
function provider(payload: unknown, status = 200) {
  const fetcher = vi.fn(async () => Response.json(payload, { status }));
  return { client: new FirecrawlSearchProvider({ enabled: true, apiKey: "private-test-key", fetcher: fetcher as typeof fetch }), fetcher };
}
afterEach(() => vi.restoreAllMocks());

describe("Firecrawl metadata Search transport", () => {
  it("uses the verified v2 contract, raw limit 50, domain filter, and no scraping", async () => {
    const { client, fetcher } = provider({ success: true, data: { web: [row] }, creditsUsed: 2 });
    const result = await client.search("site:linkedin.com/in Acme");
    const [endpoint, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/search");
    expect(request.headers).toMatchObject({ Authorization: "Bearer private-test-key" });
    expect(JSON.parse(request.body as string)).toEqual({ query: "site:linkedin.com/in Acme", limit: 50, sources: ["web"], includeDomains: ["linkedin.com"], domainTools: false, highlights: false, timeout: 30_000 });
    expect(request.body).not.toMatch(/scrape|markdown|html/i);
    expect(result).toMatchObject({ results: [row], creditsUsed: 2, rawResultCount: 1 });
  });
  it("ignores indexes and exchange tools even when they contain person-like rows", async () => {
    const { client } = provider({ success: true, data: { web: [], indexes: [row], tools: [row], contacts: [row], images: [row] } });
    expect((await client.search("query")).results).toEqual([]);
  });
  it("strips scrape fields, accepts optional position/credits, and skips malformed entries", async () => {
    const { client } = provider({ success: true, data: { web: [null, {}, { title: "missing URL" }, { ...row, position: undefined, html: "private content" }] } });
    expect(await client.search("query")).toEqual({ results: [{ ...row, position: null }], rawResultCount: 4, creditsUsed: null });
  });
  it.each([null, {}, { success: true }, { success: true, data: {} }, { success: true, data: { web: "invalid" } }, { success: true, data: { web: [{ url: row.url }] } }])("rejects malformed envelope/rows without retaining payload: %j", async (payload) => {
    await expect(provider(payload).client.search("query")).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it.each([[401, "AUTHENTICATION"], [402, "QUOTA"], [403, "AUTHENTICATION"], [429, "RATE_LIMIT"], [408, "TIMEOUT"], [504, "TIMEOUT"], [500, "PROVIDER"]])("classifies HTTP %i without exposing provider error text", async (status, kind) => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, fetcher } = provider({ error: "private-test-key raw PII" }, status as number);
    await expect(client.search("private-query")).rejects.toMatchObject({ kind, message: "Firecrawl public search failed." });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/private-test-key|raw PII|private-query/);
  });
  it("handles false-success and non-JSON responses as safe provider failures", async () => {
    await expect(provider({ success: false, error: "secret" }).client.search("query")).rejects.toMatchObject({ kind: "PROVIDER" });
    const client = new FirecrawlSearchProvider({ enabled: true, apiKey: "test", fetcher: vi.fn(async () => new Response("<html>error</html>")) as typeof fetch });
    await expect(client.search("query")).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });
  it("bounds timeout by the parent budget", async () => {
    const { client, fetcher } = provider({ success: true, data: { web: [] } });
    await client.search("query", { deadlineAtMs: Date.now() + 12_000 });
    const request = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(request.body as string).timeout).toBeLessThanOrEqual(7_000);
  });
  it("classifies its own timeout but propagates parent cancellation", async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, request) => new Promise<Response>((_resolve, reject) => request?.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true })));
    const client = new FirecrawlSearchProvider({ enabled: true, apiKey: "test", timeoutMs: 5, fetcher });
    await expect(client.search("query")).rejects.toMatchObject({ kind: "TIMEOUT" });
    const parent = AbortSignal.abort(new DOMException("Parent stopped", "AbortError"));
    await expect(client.search("query", { signal: parent })).rejects.toBe(parent.reason);
  });
  it("does not start a request when parent budget is spent or credentials are unavailable", async () => {
    const { client, fetcher } = provider({ success: true, data: { web: [] } });
    await expect(client.search("query", { deadlineAtMs: Date.now() + 100 })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new FirecrawlSearchProvider({ enabled: true, apiKey: "" }).search("query")).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });
  it("maps each failure to the fixed logging taxonomy", () => {
    for (const [kind, expected] of [["AUTHENTICATION", "AUTH_ERROR"], ["RATE_LIMIT", "RATE_LIMIT"], ["QUOTA", "RATE_LIMIT"], ["TIMEOUT", "TIMEOUT"], ["MALFORMED_RESPONSE", "MALFORMED_RESPONSE"], ["NETWORK", "PROVIDER_ERROR"]] as const) {
      expect(firecrawlFailureEvent(new FirecrawlSearchError(kind))).toBe(`FIRECRAWL_${expected}`);
    }
  });
});

const testKeys = ["secret-first-key", "secret-second-key", "secret-third-key", "secret-fourth-key", "secret-fifth-key"];
function pooledProvider(responses: Array<number | Response | Error>, apiKeys = testKeys) {
  let attempt = 0;
  const fetcher = vi.fn(async (_url: string | URL | Request, _request?: RequestInit) => {
    const value = responses[attempt++];
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    if (value === 200) return Response.json({ success: true, data: { web: [row] }, creditsUsed: 2 });
    if (typeof value !== "number") throw new Error("Unexpected extra key attempt");
    return Response.json({ success: false, error: testKeys.join(" "), creditsUsed: 99 }, { status: value, headers: { "Retry-After": "3600" } });
  });
  return { fetcher, client: new FirecrawlSearchProvider({ enabled: true, apiKeys, fetcher }) };
}

describe("Firecrawl credential failover pool", () => {
  it.each([
    [200], [401, 200], [403, 200], [402, 200], [429, 200],
    [429, 401, 200], [401, 403, 402, 429, 200]
  ])("uses ordered keys and stops at the first success: %j", async (...statuses) => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, fetcher } = pooledProvider(statuses);
    expect(await client.search("query")).toMatchObject({ results: [row], creditsUsed: 2 });
    expect(fetcher).toHaveBeenCalledTimes(statuses.length);
    for (let slot = 0; slot < statuses.length; slot += 1) {
      expect(fetcher.mock.calls[slot][1]?.headers).toMatchObject({ Authorization: `Bearer ${testKeys[slot]}` });
    }
    const events = spy.mock.calls.map(([message]) => JSON.parse(message as string));
    expect(events.filter((event) => event.event === "FIRECRAWL_KEY_FAILOVER")).toHaveLength(statuses.length - 1);
    expect(events.at(-1)).toMatchObject({ event: "FIRECRAWL_REQUEST_COMPLETED", configuredKeyCount: 5,
      keyAttempts: statuses.length, successfulKeySlot: statuses.length - 1, keyFailoverCount: statuses.length - 1, creditsUsed: 2 });
    expect(JSON.stringify(events)).not.toMatch(/secret-|Authorization|Bearer|99/);
  });

  it("trims, ignores empty entries, deduplicates credentials, and prefers an explicit pool", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { web: [] } }));
    const client = new FirecrawlSearchProvider({ enabled: true, apiKeys: [" ", "  pool-key  ", "pool-key", ""], apiKey: "legacy-key", fetcher: fetcher as typeof fetch });
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await client.search("query");
    expect(fetcher.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer pool-key" }) })]);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ configuredKeyCount: 1, keyAttempts: 1 });
  });
  it("uses the legacy constructor key when the explicit pool is empty", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { web: [] } }));
    const client = new FirecrawlSearchProvider({ enabled: true, apiKeys: ["", " "], apiKey: "legacy-key", fetcher: fetcher as typeof fetch });
    await client.search("query");
    expect(fetcher.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer legacy-key" }) })]);
  });
  it.each([
    [[429, 429, 429, 429, 429], "RATE_LIMIT", "FIRECRAWL_RATE_LIMIT"],
    [[401, 403, 401, 403, 401], "AUTHENTICATION", "FIRECRAWL_AUTH_ERROR"],
    [[402, 402, 402, 402, 402], "QUOTA", "FIRECRAWL_RATE_LIMIT"],
    [[429, 401, 402, 403, 429], "RATE_LIMIT", "FIRECRAWL_RATE_LIMIT"]
  ])("returns one safe final error after all keys fail: %j", async (statuses, kind, event) => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, fetcher } = pooledProvider(statuses);
    const error = await client.search("private-query").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(FirecrawlSearchError);
    expect(error).toMatchObject({ kind, message: "Firecrawl public search failed." });
    expect(firecrawlFailureEvent(error)).toBe(event);
    expect(fetcher).toHaveBeenCalledTimes(5);
    const events = spy.mock.calls.map(([message]) => JSON.parse(message as string));
    expect(events.filter((value) => value.event === "FIRECRAWL_REQUEST_FAILED")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ configuredKeyCount: 5, keyAttempts: 5, keyFailoverCount: 4 });
    expect(`${JSON.stringify(events)} ${JSON.stringify(error)} ${String(error)}`).not.toMatch(/secret-|Authorization|Bearer|private-query/);
  });
  it.each([400, 404, 408, 413, 422, 500, 502, 503, 504])("does not rotate on request/provider-wide HTTP %i", async (status) => {
    const { client, fetcher } = pooledProvider([status, 200]);
    await expect(client.search("query")).rejects.toBeInstanceOf(FirecrawlSearchError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    Response.json({ success: true, data: { web: "invalid" } }),
    Response.json({ success: false, error: "Insufficient credits" }),
    new Response("<html>provider error</html>"),
    new Error("Network failed with Authorization: Bearer secret-first-key")
  ])("does not rotate on malformed responses, free-text quota messages, or network failures: %s", async (failure) => {
    const { client, fetcher } = pooledProvider([failure, 200]);
    await expect(client.search("query")).rejects.toMatchObject({ message: "Firecrawl public search failed." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not attempt keys after an already-cancelled parent", async () => {
    const { client, fetcher } = pooledProvider([200]);
    const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));
    await expect(client.search("query", { signal })).rejects.toBe(signal.reason);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops immediately if the parent cancels during a key failure", async () => {
    const controller = new AbortController();
    const { client, fetcher } = pooledProvider([401, 200]);
    fetcher.mockImplementationOnce(async () => {
      controller.abort(new DOMException("Stopped", "AbortError"));
      return new Response(null, { status: 401 });
    });
    await expect(client.search("query", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops before another key when the parent's cleanup reserve is reached", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { client, fetcher } = pooledProvider([429, 200]);
    fetcher.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 3_000);
      return new Response(null, { status: 429 });
    });
    await expect(client.search("query", { deadlineAtMs: now + 8_000 })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shares one signal and decreases the timeout across key attempts within the parent budget", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { client, fetcher } = pooledProvider([429, 200]);
    fetcher.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 2_000);
      return new Response(null, { status: 429 });
    });
    await client.search("query", { deadlineAtMs: now + 8_000 });
    const requests = fetcher.mock.calls.map((call) => call[1]!);
    expect(JSON.parse(requests[0].body as string).timeout).toBe(3_000);
    expect(JSON.parse(requests[1].body as string).timeout).toBe(1_000);
    expect(requests[1].signal).toBe(requests[0].signal);
  });
  it("does not reset a spent Firecrawl timeout for the next key", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { client, fetcher } = pooledProvider([401, 200]);
    fetcher.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 30_000);
      return new Response(null, { status: 401 });
    });
    await expect(client.search("query")).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("a network timeout stops the pool instead of trying every key", async () => {
    const fetcher: typeof fetch = vi.fn(async (_url, request) => new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
    }));
    const client = new FirecrawlSearchProvider({ enabled: true, apiKeys: testKeys, timeoutMs: 5, fetcher });
    await expect(client.search("query")).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
