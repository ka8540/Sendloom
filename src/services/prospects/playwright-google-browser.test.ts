import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright-core";
import { PlaywrightGoogleSearchProvider } from "./playwright-google-search-provider";
import { PublicSearchDiscoveryProvider, publicCounters } from "./public-profile-search";
import { PersonIdentitySet } from "./discover-person-identity";

// Explicit local browser QA: every request is fulfilled from a fixture or aborted.
// Normal CI unit runs do not require a locally installed Chrome.
describe.runIf(process.env.DISCOVER_GOOGLE_BROWSER_TEST === "1")("real Chromium SERP fixture", () => {
  it("extracts rendered cards with one navigation and never visits result links", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 10_000 });
    const newContext = browser.newContext.bind(browser);
    const requests: string[] = [];
    const navigationUrls: string[] = [];
    vi.spyOn(browser, "newContext").mockImplementation(async options => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      vi.spyOn(context, "newPage").mockImplementation(async () => {
        const page = await newPage();
        await page.route("**/*", async route => {
          const request = route.request(); requests.push(request.url());
          if (request.isNavigationRequest() && request.url().startsWith("https://www.google.com/search?")) {
            navigationUrls.push(request.url());
            await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body><div id="search">
              <div class="g"><div><a href="https://www.linkedin.com/in/jane/?trk=google"><h3>Jane Doe - Software Engineer at Abacus Insights | LinkedIn</h3></a></div><div>Dallas, Texas<br>Software Engineer at Abacus Insights</div></div>
              <div class="g"><div><a href="/url?q=https%3A%2F%2Flinkedin.com%2Fin%2Fjohn"><h3>John Smith - Software Engineer at Abacus Insights | LinkedIn</h3></a></div><div>Seattle, Washington · Software Engineer at Abacus Insights</div></div>
              <div style="display:none"><a href="https://linkedin.com/in/hidden"><h3>Hidden Name - Software Engineer at Abacus Insights | LinkedIn</h3></a></div>
              <div class="g"><a href="https://linkedin.com/company/abacus"><h3>Abacus Insights - Software Engineer | LinkedIn</h3></a></div>
              <div class="g"><a href="https://example.com/in/not-linkedin"><h3>Wrong Person - Software Engineer at Abacus Insights | LinkedIn</h3></a></div>
            </div><a href="https://www.google.com/search?start=10">Next</a></body></html>` });
          } else await route.abort();
        });
        return page;
      });
      return context;
    });
    try {
      const provider = new PublicSearchDiscoveryProvider(new PlaywrightGoogleSearchProvider(async () => browser));
      const result = await provider.searchProfiles({ companyName: "Abacus Insights", jobTitles: ["Software Engineer", "Software Developer", "Backend Software Engineer", "Frontend Software Engineer", "Application Developer"], locations: ["United States"], maxResults: 25 }, {
        target: 10, validate: async people => people, denied: new PersonIdentitySet(), diagnostics: publicCounters()
      });
      expect(result.profiles.map(p => p.sourceProfileId)).toEqual(["jane", "john"]);
      expect(result.profiles.map(p => p.location)).toEqual(["Dallas, Texas", "Seattle, Washington"]);
      expect(result.profiles.every(p => p.country === "United States")).toBe(true);
      expect(navigationUrls).toHaveLength(1);
      expect(requests).toEqual(navigationUrls);
      expect(new URL(navigationUrls[0]).searchParams.get("q")).toContain('"Software Engineer" OR "Software Developer"');
      expect(browser.isConnected()).toBe(false);
    } finally { vi.restoreAllMocks(); await browser.close(); }
  }, 30_000);
});
