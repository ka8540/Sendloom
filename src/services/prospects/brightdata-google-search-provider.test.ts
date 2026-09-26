import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrightDataGoogleSearchProvider } from "./brightdata-google-search-provider";

describe("BrightDataGoogleSearchProvider", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
  });

  it("requests parsed SERP JSON with brd_json=1 and keeps stable Google parameters", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    });
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      fetcher: fetcher as typeof fetch
    });

    await provider.search("query", { page: 1, requestedLocations: ["United States"] });
    await provider.search("query", { page: 2, requestedLocations: ["United States"] });

    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ zone: "zone", format: "raw" });
    const params = new URL(request.url).searchParams;
    expect(params.get("brd_json")).toBe("1");
    expect(params.get("brd_json")).not.toBe("json");
    expect(params.get("udm")).toBe("14");
    expect(params.get("hl")).toBe("en");
    expect(params.get("pws")).toBe("0");
    expect(params.get("gl")).toBe("us");
    expect(params.get("start")).toBe("0");
    expect(new URL(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).url).searchParams.get("start")).toBe("10");
  });

  it.each([
    ["organic", { organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }] }],
    ["result.organic", { result: { organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }] } }],
    ["body JSON", { body: JSON.stringify({ organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }] }) }]
  ] as const)("parses documented response shape %s", async (_shape, payload) => {
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      fetcher: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
    });
    const result = await provider.search("query", { page: 1, requestedLocations: [] });
    expect(result.results).toHaveLength(1);
    expect(result.rawOrganicResults).toBe(1);
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "AUTHENTICATION"],
    [500, "PROVIDER"]
  ] as const)("classifies HTTP %i safely with stage diagnostics", async (status, kind) => {
    const apiKey = `super-private-api-key-${status}`;
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey,
      zone: "zone",
      fetcher: vi.fn(async () => new Response(JSON.stringify({ detail: "private body https://linkedin.com/in/jane" }), { status })) as typeof fetch
    });

    await expect(provider.search("private search query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind, status, stage: "HTTP_ERROR" });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "BRIGHT_REQUEST_FAILED",
      status,
      kind,
      stage: "HTTP_ERROR"
    }));
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).not.toContain(apiKey);
    expect(logs).not.toContain("private search query");
    expect(logs).not.toContain("linkedin.com");
    expect(logs).not.toContain("private body");
  });

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
    await expect(provider.search("private search query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind: "MALFORMED_RESPONSE", status: 200, stage: "ORGANIC_ARRAY_MISSING", message: "Bright Data public search failed." });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "BRIGHT_REQUEST_FAILED",
      status: 200,
      kind: "MALFORMED_RESPONSE",
      stage: "ORGANIC_ARRAY_MISSING"
    }));
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).not.toContain("private");
    expect(logs).not.toContain("private search query");
  });

  it("classifies an invalid JSON body as a JSON_PARSE stage failure", async () => {
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      fetcher: vi.fn(async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch
    });
    await expect(provider.search("query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind: "MALFORMED_RESPONSE", status: 200, stage: "JSON_PARSE" });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "BRIGHT_REQUEST_FAILED",
      status: 200,
      kind: "MALFORMED_RESPONSE",
      stage: "JSON_PARSE"
    }));
    expect(info.mock.calls.flat().join(" ")).not.toContain("not json");
  });

  it("classifies fetch exceptions as network-stage provider failures without leaking details", async () => {
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "super-private-api-key",
      zone: "zone",
      fetcher: vi.fn(async () => {
        throw new TypeError("fetch failed for super-private-api-key and private search query https://linkedin.com/in/jane");
      }) as typeof fetch
    });
    await expect(provider.search("private search query", { page: 1, requestedLocations: [] }))
      .rejects.toMatchObject({ kind: "PROVIDER", status: null, stage: "NETWORK" });
    const logs = info.mock.calls.flat().join(" ");
    expect(logs).toContain(JSON.stringify({
      event: "BRIGHT_REQUEST_FAILED",
      status: null,
      kind: "PROVIDER",
      stage: "NETWORK"
    }));
    expect(logs).not.toContain("super-private-api-key");
    expect(logs).not.toContain("private search query");
    expect(logs).not.toContain("linkedin.com");
    expect(logs).not.toContain("fetch failed");
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
      .rejects.toMatchObject({ kind: "TIMEOUT", status: null, stage: "TIMEOUT" });
    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "BRIGHT_REQUEST_FAILED",
      status: null,
      kind: "TIMEOUT",
      stage: "TIMEOUT"
    }));
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

  it("uses real Google start offsets for successive SERP pages", async () => {
    const starts: string[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      starts.push(new URL(request.url).searchParams.get("start") ?? "");
      return new Response(JSON.stringify({
        organic: [{ title: "Jane Doe | LinkedIn", link: "https://linkedin.com/in/jane" }]
      }), { status: 200 });
    });
    const provider = new BrightDataGoogleSearchProvider({
      enabled: true,
      apiKey: "secret",
      zone: "zone",
      maxPages: 10,
      fetcher: fetcher as typeof fetch
    });

    await provider.search("query", { page: 1, requestedLocations: [] });
    await provider.search("query", { page: 2, requestedLocations: [] });
    await provider.search("query", { page: 3, requestedLocations: [] });

    expect(starts).toEqual(["0", "10", "20"]);
  });
});
