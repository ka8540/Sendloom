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
  it.each([[401, "AUTHENTICATION"], [403, "AUTHENTICATION"], [429, "RATE_LIMIT"], [408, "TIMEOUT"], [504, "TIMEOUT"], [500, "PROVIDER"]])("classifies HTTP %i without exposing provider error text", async (status, kind) => {
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
    for (const [kind, expected] of [["AUTHENTICATION", "AUTH_ERROR"], ["RATE_LIMIT", "RATE_LIMIT"], ["TIMEOUT", "TIMEOUT"], ["MALFORMED_RESPONSE", "MALFORMED_RESPONSE"], ["NETWORK", "PROVIDER_ERROR"]] as const) {
      expect(firecrawlFailureEvent(new FirecrawlSearchError(kind))).toBe(`FIRECRAWL_${expected}`);
    }
  });
});
