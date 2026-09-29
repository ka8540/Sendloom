import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  for (const key of ["DISCOVER_FIRECRAWL_ENABLED", "FIRECRAWL_API_KEY", "DISCOVER_FIRECRAWL_TIMEOUT_MS", "DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY", "DISCOVER_FIRECRAWL_MAX_QUERIES", "DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION", "DISCOVER_FIRECRAWL_SCRAPE_RESULTS"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("validated Firecrawl server configuration", () => {
  it("has bounded defaults and accepts an empty example API-key value", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    const { getEnv } = await import("./env");
    const env = getEnv();
    expect(env.DISCOVER_FIRECRAWL_ENABLED).toBe(true);
    expect(env.FIRECRAWL_API_KEY).toBeUndefined();
    expect(env.DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY).toBe(50);
    expect(env.DISCOVER_FIRECRAWL_TIMEOUT_MS).toBe(30_000);
    expect(env.DISCOVER_FIRECRAWL_MAX_QUERIES).toBe(5);
    expect(env.DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION).toBe(2);
    expect(env.DISCOVER_FIRECRAWL_SCRAPE_RESULTS).toBe(false);
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
