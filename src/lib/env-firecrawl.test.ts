import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  for (const key of ["DISCOVER_FIRECRAWL_ENABLED", "FIRECRAWL_API_KEYS", "FIRECRAWL_API_KEY", "DISCOVER_FIRECRAWL_TIMEOUT_MS", "DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY", "DISCOVER_FIRECRAWL_MAX_QUERIES", "DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION", "DISCOVER_FIRECRAWL_SCRAPE_RESULTS"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("validated Firecrawl server configuration", () => {
  it("has bounded defaults and accepts an empty example API-key value", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    const { getEnv } = await import("./env");
    const env = getEnv();
    expect(env.DISCOVER_FIRECRAWL_ENABLED).toBe(true);
    expect(env.FIRECRAWL_API_KEY).toBeUndefined();
    expect(env.FIRECRAWL_API_KEYS).toEqual([]);
    expect(env.DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY).toBe(50);
    expect(env.DISCOVER_FIRECRAWL_TIMEOUT_MS).toBe(30_000);
    expect(env.DISCOVER_FIRECRAWL_MAX_QUERIES).toBe(5);
    expect(env.DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION).toBe(2);
    expect(env.DISCOVER_FIRECRAWL_SCRAPE_RESULTS).toBe(false);
  });
  it.each([
    [undefined, "legacy-test-key", [], "legacy-test-key"],
    ["pool-test-key", undefined, ["pool-test-key"], "pool-test-key"],
    ["pool-first,pool-second", "legacy-test-key", ["pool-first", "pool-second"], "pool-first"],
    ["  pool-first , , pool-second,  ", undefined, ["pool-first", "pool-second"], "pool-first"],
    [" , , ", "  legacy-test-key  ", [], "legacy-test-key"],
    ["", "legacy-test-key", [], "legacy-test-key"]
  ])("normalizes pool %j and selects it before the legacy key", async (pool, singleKey, expectedPool, expectedKey) => {
    vi.stubEnv("FIRECRAWL_API_KEYS", pool);
    vi.stubEnv("FIRECRAWL_API_KEY", singleKey);
    const { getEnv } = await import("./env");
    expect(getEnv().FIRECRAWL_API_KEYS).toEqual(expectedPool);
    const { FirecrawlSearchProvider } = await import("@/services/prospects/firecrawl-search-provider");
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { web: [] } }));
    const client = new FirecrawlSearchProvider({ fetcher: fetcher as typeof fetch });
    expect(client.configured).toBe(true);
    await client.search("query");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${expectedKey}` })
    })]);
  });
  it.each([undefined, "", " , , "])("remains unavailable without either usable credential setting: %j", async (pool) => {
    vi.stubEnv("FIRECRAWL_API_KEYS", pool);
    const { FirecrawlSearchProvider } = await import("@/services/prospects/firecrawl-search-provider");
    const fetcher = vi.fn();
    const client = new FirecrawlSearchProvider({ fetcher });
    expect(client.configured).toBe(false);
    await expect(client.search("query")).rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY", "101"],
    ["DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY", "0"],
    ["DISCOVER_FIRECRAWL_MAX_QUERIES", "21"],
    ["DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION", "0"],
    ["DISCOVER_FIRECRAWL_TIMEOUT_MS", "4999"],
    ["DISCOVER_FIRECRAWL_SCRAPE_RESULTS", "true"]
  ])("rejects invalid or scraping-enabled configuration: %s", async (key, value) => {
    vi.stubEnv(key, value);
    const { getEnvStatus } = await import("./env");
    expect(getEnvStatus()).toMatchObject({ ok: false, missing: expect.arrayContaining([key]) });
  });
});
