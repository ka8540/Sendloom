import { describe, expect, it, vi } from "vitest";

import { BrightDataGoogleSearchProvider } from "./brightdata-google-search-provider";

describe("BrightDataGoogleSearchProvider", () => {
  it("maps sanitized organic evidence and derives Google geography", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      organic: [{
        title: "Jane Doe - Software Engineer at Acme | LinkedIn",
        link: "https://fr.linkedin.com/in/jane-doe?trk=google",
        description: "Software Engineer at Acme · Paris, Île-de-France, France",
        display_link: "fr.linkedin.com › in › jane-doe",
        rich_snippet: { top: { extensions: ["Paris, Île-de-France, France"] } }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "serp-zone",
      fetcher: fetcher as typeof fetch
    });

    const result = await provider.search("site:linkedin.com/in Acme", { page: 1, requestedLocations: ["France"] });
    expect(result.results[0]).toMatchObject({
      title: "Jane Doe - Software Engineer at Acme | LinkedIn",
      displayedUrl: "fr.linkedin.com › in › jane-doe"
    });
    expect(result.results[0].evidence).toContain("Paris, Île-de-France, France");
    expect(result.rawOrganicResults).toBe(1);
    expect(result.exhausted).toBe(false);
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(new URL(request.url).searchParams.get("gl")).toBe("fr");
  });

  it("rejects malformed response shapes without exposing payloads", async () => {
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      fetcher: vi.fn(async () => new Response(JSON.stringify({ unexpected: "private" }), { status: 200 })) as typeof fetch
    });
    await expect(provider.search("query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind: "MALFORMED_RESPONSE", message: "Bright Data public search failed." });
  });

  it("uses a bounded configurable timeout and classifies it as transient", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
    );
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      timeoutMs: 5,
      fetcher: fetcher as typeof fetch
    });
    await expect(provider.search("query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("only exhausts on zero raw rows or the configured maximum page", async () => {
    const payloads = [
      { organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }] },
      { organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }] },
      { organic: [] }
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payloads.shift()), { status: 200 }));
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      maxPages: 3,
      fetcher: fetcher as typeof fetch
    });
    expect((await provider.search("query", { page: 1, requestedLocations: [] })).exhausted).toBe(false);
    expect((await provider.search("query", { page: 3, requestedLocations: [] })).exhausted).toBe(true);
    expect((await provider.search("query", { page: 2, requestedLocations: [] })).exhausted).toBe(true);
  });
});
