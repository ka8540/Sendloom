import type { Browser, Page } from "playwright-core";
import { env } from "@/lib/env";
import type { WebSearchOptions, WebSearchProvider, WebSearchResult } from "./web-search-provider";
import { canonicalizeLinkedInProfileUrl } from "./linkedin-profile-url";
import { parseLinkedInSearchResult } from "./linkedin-search-result-parser";

export const GOOGLE_SERP_LIMITS = { timeoutMs: 20_000, launchTimeoutMs: 10_000, maxCards: 100, maxQueryLength: 1_500 } as const;
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
export async function extractGoogleSerpPeople(page: Page): Promise<GoogleSerpCandidate[]> {
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
  }, GOOGLE_SERP_LIMITS.maxCards);
  return cards.flatMap(card => {
    const linkedinUrl = profileUrl(card.url);
    if (!linkedinUrl) return [];
    const evidence = { ...card, url: linkedinUrl };
    // Reuse existing source-name/position extraction; no Google-only name parser.
    const profile = parseLinkedInSearchResult(evidence);
    if (!profile?.sourceName) return [];
    return [{ person: { name: profile.sourceName, linkedinUrl, location: profile.location }, evidence }];
  });
}

/** One fresh browser context, one Google navigation, and no other search provider. */
export class PlaywrightGoogleSearchProvider implements WebSearchProvider {
  readonly configured = true;
  readonly maxResultsPerRequest = GOOGLE_SERP_LIMITS.maxCards;
  readonly peopleQueryStrategy = "single_role_union" as const;

  constructor(private readonly launch: GoogleBrowserLauncher = launchGoogleBrowser) {}

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    // Pagination is intentionally unsupported, even for a caller outside Discover.
    if ((options.page ?? 1) !== 1) return [];
    if (!query.startsWith("site:linkedin.com/in ") || query.length > GOOGLE_SERP_LIMITS.maxQueryLength) {
      throw new Error("Google people search requires a bounded LinkedIn query.");
    }
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "en");
    const timeout = AbortSignal.timeout(GOOGLE_SERP_LIMITS.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let browser: Browser | undefined;
    let closing: Promise<void> | undefined;
    const close = () => {
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
      let navigationRequests = 0;
      await context.route("**/*", async route => {
        const request = route.request();
        const target = new URL(request.url());
        const isGoogle = target.protocol === "https:" && /(^|\.)(google\.com|gstatic\.com)$/.test(target.hostname);
        const allowedNavigation = request.frame() === page.mainFrame() && request.url() === url.toString()
          && (!request.isNavigationRequest() || ++navigationRequests === 1);
        if (!isGoogle || (request.isNavigationRequest() && !allowedNavigation)
          || ["image", "media", "font"].includes(request.resourceType())) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
      // No pagination, per-alias queries, consent clicks, challenge retries or profile visits.
      const response = await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: GOOGLE_SERP_LIMITS.timeoutMs });
      if (!response?.ok() || page.url() !== url.toString()
        || await page.locator('#captcha-form, form[action*="/sorry/"], iframe[src*="recaptcha"], form[action*="consent"]').count()) {
        throw new Error("Google search is unavailable.");
      }
      await page.locator("#search, #rso").first().waitFor({ state: "attached", timeout: 3_000 });
      const candidates = await extractGoogleSerpPeople(page);
      signal.throwIfAborted();
      const count = Number.isFinite(options.count) ? Math.max(1, Math.min(GOOGLE_SERP_LIMITS.maxCards, Math.floor(options.count!))) : GOOGLE_SERP_LIMITS.maxCards;
      // The generic search interface carries transient evidence into the shared
      // validator; the extracted public identity has only name, URL and location.
      return candidates.slice(0, count).map(candidate => candidate.evidence);
    } catch {
      // Never log or expose browser errors, HTML, URLs, names, or query strings.
      throw new Error("Google people search is temporarily unavailable.");
    } finally {
      signal.removeEventListener("abort", onAbort);
      await close();
    }
  }
}
