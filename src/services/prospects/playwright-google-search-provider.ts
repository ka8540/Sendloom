import type { Browser, Page } from "playwright-core";
import { env } from "@/lib/env";
import type { PublicCrawlDiagnostics, WebSearchOptions, WebSearchProvider, WebSearchResult } from "./web-search-provider";
import { canonicalizeLinkedInProfileUrl } from "./linkedin-profile-url";
import { parseLinkedInSearchResult } from "./linkedin-search-result-parser";

export const GOOGLE_SERP_LIMITS = { timeoutMs: 60_000, launchTimeoutMs: 10_000, maxCards: 100, maxQueryLength: 1_500 } as const;
export type GooglePublicPerson = { name: string; linkedinUrl: string; location: string | null };
/** Evidence stays internal to validation; it is not part of the public person projection. */
export type GoogleSerpCandidate = { person: GooglePublicPerson; evidence: WebSearchResult };
export type GoogleBrowserLauncher = () => Promise<Browser>;

async function launchGoogleBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const executablePath = env.DISCOVER_GOOGLE_EXECUTABLE_PATH;
  if (executablePath) {
    return chromium.launch({ executablePath, headless: true, timeout: GOOGLE_SERP_LIMITS.launchTimeoutMs });
  }
  if (process.platform === "linux") {
    const { default: serverChromium } = await import("@sparticuz/chromium");
    return chromium.launch({ executablePath: await serverChromium.executablePath(),
      args: serverChromium.args, headless: true, timeout: GOOGLE_SERP_LIMITS.launchTimeoutMs });
  }
  // Local development uses the installed Chrome; never a logged-in browser profile.
  return chromium.launch({ channel: "chrome", headless: true, timeout: GOOGLE_SERP_LIMITS.launchTimeoutMs });
}

/** Google redirect links are decoded, never followed. Only /in/ URLs survive. */
function profileUrl(href: string): string | null {
  try {
    const url = new URL(href, "https://www.google.com");
    const target = url.hostname === "www.google.com" && url.pathname === "/url"
      ? url.searchParams.get("q") ?? url.searchParams.get("url") ?? ""
      : url.toString();
    return canonicalizeLinkedInProfileUrl(target)?.linkedinUrl ?? null;
  } catch { return null; }
}

/** Read rendered organic cards in the existing SERP only: no clicks, scrolls or navigation. */
export async function extractGoogleSerpPeople(page: Page, diagnostics?: PublicCrawlDiagnostics, maxCards: number = GOOGLE_SERP_LIMITS.maxCards): Promise<GoogleSerpCandidate[]> {
  const cards = await page.evaluate((maxCards) => {
    const root = document.querySelector("#search") ?? document.querySelector("#rso");
    if (!root) return [];
    const rows: Array<{ title: string; url: string; snippet: string | null }> = [];
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a:has(h3)")) {
      if (rows.length >= maxCards) break;
      const heading = anchor.querySelector<HTMLElement>("h3");
      if (!heading || !heading.getClientRects().length) continue;
      let hidden = false;
      for (let element: HTMLElement | null = heading; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") { hidden = true; break; }
      }
      if (hidden) continue;
      // Find the card containing this heading without crossing into another
      // person's result. This avoids depending on Google's changing CSS classes.
      let card: HTMLElement = anchor;
      for (let depth = 0; depth < 8; depth++) {
        const parent = card.parentElement;
        if (!parent || parent === root || parent.querySelectorAll("h3").length !== 1) break;
        card = parent;
      }
      const title = heading.innerText.trim();
      if (!title) continue;
      const text = card.innerText;
      const afterTitle = text.indexOf(title);
      const snippet = afterTitle >= 0 ? text.slice(afterTitle + title.length).trim() : "";
      rows.push({ title: title.slice(0, 800), url: anchor.href, snippet: snippet.split(/\n+/).map(line => line.trim()).filter(Boolean).join(" · ").slice(0, 4_000) || null });
    }
    return rows;
  }, Math.min(GOOGLE_SERP_LIMITS.maxCards, maxCards));
  if (diagnostics) diagnostics.googleResultCards += Math.min(cards.length, maxCards);
  return cards.slice(0, maxCards).flatMap(card => {
    const linkedinUrl = profileUrl(card.url);
    if (!linkedinUrl) { if (diagnostics) diagnostics.invalidLinkedinUrls++; return []; }
    if (diagnostics) diagnostics.linkedinPersonUrls++;
    const evidence = { ...card, url: linkedinUrl };
    // Reuse existing source-name/position extraction; no Google-only name parser.
    const profile = parseLinkedInSearchResult(evidence);
    if (!profile?.sourceName) return [];
    return [{ person: { name: profile.sourceName, linkedinUrl, location: profile.location }, evidence }];
  });
}

/** Only a visible Next link for the same query on Google's search endpoint is eligible. */
export async function nextGoogleResultsPage(page: Page, query: string): Promise<string | null> {
  const links = await page.locator('a#pnnext, a[rel="next"], a[aria-label="Next"]').evaluateAll(anchors =>
    anchors.filter(anchor => anchor.getClientRects().length > 0
      && getComputedStyle(anchor).visibility !== "hidden")
      .map(anchor => (anchor as HTMLAnchorElement).href));
  const current = new URL(page.url());
  for (const href of links) {
    try {
      const next = new URL(href, current);
      const start = Number(next.searchParams.get("start"));
      if (next.origin === "https://www.google.com" && next.pathname === "/search"
        && next.searchParams.get("q") === query && Number.isSafeInteger(start)
        && start > Number(current.searchParams.get("start") ?? 0)) return next.toString();
    } catch { /* Ignore malformed or foreign links. */ }
  }
  return null;
}

export type GoogleCrawlLimits = { maxPages: number; maxCandidates: number; navigationTimeoutMs: number; timeoutMs: number };
// The shared fingerprint lock prevents duplicate crawls. This additional guard
// caps browser concurrency across different searches within a Node process.
let crawlActive = false;

/** Bounded, awaited execution. The launcher can be supplied by a dedicated Node executor. */
export class PlaywrightGoogleSearchProvider implements WebSearchProvider {
  readonly configured = true;
  readonly maxResultsPerRequest = 500;
  readonly materializesPool = true;
  readonly peopleQueryStrategy = "single_role_union" as const;

  constructor(private readonly launch: GoogleBrowserLauncher = launchGoogleBrowser,
    private readonly limits: GoogleCrawlLimits = {
      maxPages: env.PLAYWRIGHT_GOOGLE_MAX_PAGES,
      maxCandidates: env.PLAYWRIGHT_GOOGLE_MAX_CANDIDATES,
      navigationTimeoutMs: env.PLAYWRIGHT_GOOGLE_NAVIGATION_TIMEOUT_MS,
      timeoutMs: GOOGLE_SERP_LIMITS.timeoutMs
    }) {}

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    // A provider operation owns the full bounded crawl; external pagination cannot restart it.
    if ((options.page ?? 1) !== 1) return [];
    if (!query.startsWith("site:linkedin.com/in ") || query.length > GOOGLE_SERP_LIMITS.maxQueryLength) {
      throw new Error("Google people search requires a bounded LinkedIn query.");
    }
    if (crawlActive) throw new Error("Google people search is busy. Try again shortly.");
    crawlActive = true;
    const started = Date.now();
    const diagnostics: PublicCrawlDiagnostics = { playwrightSearchRuns: 1, playwrightPagesVisited: 0,
      googleResultCards: 0, linkedinPersonUrls: 0, invalidLinkedinUrls: 0, duplicateProfiles: 0,
      profilesWithLocation: 0, profilesMissingLocation: 0, captchaDetected: false, blocked: false,
      durationMs: 0, stopReason: "failure" };
    const initial = new URL("https://www.google.com/search");
    initial.searchParams.set("q", query); initial.searchParams.set("hl", "en");
    const signal = options.signal ? AbortSignal.any([AbortSignal.timeout(this.limits.timeoutMs), options.signal])
      : AbortSignal.timeout(this.limits.timeoutMs);
    let browser: Browser | undefined;
    let closing: Promise<void> | undefined;
    const close = () => {
      // Browser.close tears down all owned pages and contexts as well.
      if (browser && !closing) closing = browser.close().catch(() => undefined);
      return closing;
    };
    const onAbort = () => { void close(); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      browser = await this.launch();
      signal.throwIfAborted();
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 960 } });
      const page = await context.newPage();
      let allowedUrl = initial.toString();
      let navigationAllowed = false;
      await context.route("**/*", async route => {
        const request = route.request();
        const target = new URL(request.url());
        const isGoogle = target.protocol === "https:" && /(^|\.)(google\.com|gstatic\.com)$/.test(target.hostname);
        if (request.isNavigationRequest()) {
          if (!navigationAllowed || request.frame() !== page.mainFrame() || request.url() !== allowedUrl) {
            await route.abort(); return;
          }
          navigationAllowed = false;
        }
        if (!isGoogle || ["image", "media", "font"].includes(request.resourceType())) await route.abort();
        else await route.continue();
      });
      const identities = new Set<string>();
      const visited = new Set<string>();
      const results: WebSearchResult[] = [];
      for (let index = 0; index < this.limits.maxPages; index++) {
        signal.throwIfAborted();
        if (visited.has(allowedUrl)) { diagnostics.stopReason = "repeated_page"; break; }
        visited.add(allowedUrl); navigationAllowed = true;
        diagnostics.playwrightPagesVisited++;
        const response = await page.goto(allowedUrl, { waitUntil: "domcontentloaded", timeout: this.limits.navigationTimeoutMs });
        const body = (await page.locator("body").innerText({ timeout: this.limits.navigationTimeoutMs })).slice(0, 100_000);
        diagnostics.captchaDetected = await page.locator('#captcha-form, form[action*="/sorry/"], iframe[src*="recaptcha"]').count() > 0
          || /captcha|recaptcha/i.test(body);
        diagnostics.blocked = diagnostics.captchaDetected || !response?.ok() || page.url() !== allowedUrl
          || await page.locator('form[action*="consent"]').count() > 0
          || /unusual traffic|access denied|before you continue to google|automated queries/i.test(body);
        if (diagnostics.blocked) { diagnostics.stopReason = diagnostics.captchaDetected ? "captcha" : "blocked"; throw new Error(); }
        // A genuine empty result page is successful exhaustion, not an HTML parsing failure.
        if (/did not match any documents|no results found/i.test(body)) { diagnostics.stopReason = "no_results"; break; }
        await page.locator("#search, #rso").first().waitFor({ state: "attached", timeout: 3_000 });
        const candidates = await extractGoogleSerpPeople(page, diagnostics, this.limits.maxCandidates - diagnostics.googleResultCards);
        let added = 0;
        for (const candidate of candidates) {
          if (results.length >= this.limits.maxCandidates) break;
          if (identities.has(candidate.person.linkedinUrl)) diagnostics.duplicateProfiles++;
          else { identities.add(candidate.person.linkedinUrl); added++; }
          if (candidate.person.location) diagnostics.profilesWithLocation++; else diagnostics.profilesMissingLocation++;
          // Keep bounded duplicate evidence until shared validation: a later
          // former-employment card must still invalidate an earlier current card.
          results.push(candidate.evidence);
        }
        if (diagnostics.googleResultCards >= this.limits.maxCandidates) { diagnostics.stopReason = "max_candidates"; break; }
        if (!added) { diagnostics.stopReason = "no_new_profiles"; break; }
        const next = await nextGoogleResultsPage(page, query);
        if (!next) { diagnostics.stopReason = "no_next"; break; }
        diagnostics.stopReason = "max_pages";
        allowedUrl = next;
      }
      signal.throwIfAborted();
      // count is a UI/API result-window hint; a pool crawl retains its whole bounded dataset.
      return results;
    } catch {
      if (signal.aborted) diagnostics.stopReason = "timeout";
      // Fail the operation atomically; partial blocked runs are never marked fresh/complete.
      throw new Error("Google people search is temporarily unavailable.");
    } finally {
      signal.removeEventListener("abort", onAbort);
      await close(); crawlActive = false;
      diagnostics.durationMs = Date.now() - started;
      options.onCrawlDiagnostics?.(diagnostics);
    }
  }
}
