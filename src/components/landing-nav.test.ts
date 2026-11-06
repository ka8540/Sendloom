import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
 * Landing anchor contract.
 *
 * This guards a failure that shipped silently: the nav pointed "Why Sendloom"
 * at #chaos and "Workflow" at #workflow after a redesign had removed both
 * sections, so two of the four primary nav items scrolled nowhere and the
 * footer repeated the same two dead links. Nothing caught it, because a dead
 * fragment link throws no error — it just does nothing.
 *
 * The components are "use client" and the suite runs in a node env, so wiring
 * is verified through source assertions, the style used across this codebase.
 */
const NAV_SOURCE = readFileSync("src/components/landing-nav.tsx", "utf8");
const PAGE_SOURCE = readFileSync("src/app/page.tsx", "utf8");
const FOOTER_SOURCE = readFileSync("src/components/marketing/MarketingFooter.tsx", "utf8");
const LAYOUT_SOURCE = readFileSync("src/app/layout.tsx", "utf8");
const LANDING_CSS = readFileSync("src/app/landing.module.css", "utf8");
const NEXT_CONFIG = readFileSync("next.config.mjs", "utf8");

/* Every `id="…"` rendered by the landing page, its footer and the root layout,
   which together are all the markup a landing-page fragment link can target. */
function renderedIds(): Set<string> {
  const ids = new Set<string>();
  for (const source of [PAGE_SOURCE, FOOTER_SOURCE, LAYOUT_SOURCE]) {
    for (const [, id] of source.matchAll(/\bid="([^"{]+)"/g)) {
      ids.add(id);
    }
  }
  return ids;
}

/* Strips comments so an assertion about what the code does cannot be satisfied
   — or broken — by prose describing what it used to do. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* Fragment targets of every hard-coded href in a source file. Covers both the
   JSX attribute (`href="#thing"`) and the config-object property (`href:
   "#thing"`) the nav uses, plus the cross-page `/#thing` form in the footer. */
function fragmentTargets(source: string): string[] {
  return [...code(source).matchAll(/href[=:]\s*["'`]\/?#([^"'`]+)["'`]/g)].map(([, id]) => id);
}

describe("landing navigation anchors", () => {
  it("resolves every nav fragment link to an element that exists", () => {
    const ids = renderedIds();
    const targets = fragmentTargets(NAV_SOURCE);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(ids, `nav links to #${target}, which nothing renders`).toContain(target);
    }
  });

  it("resolves every footer fragment link to an element that exists", () => {
    const ids = renderedIds();

    for (const target of fragmentTargets(FOOTER_SOURCE)) {
      expect(ids, `footer links to #${target}, which nothing renders`).toContain(target);
    }
  });

  it("resolves every in-page link on the landing page itself", () => {
    const ids = renderedIds();

    for (const target of fragmentTargets(PAGE_SOURCE)) {
      expect(ids, `landing page links to #${target}, which nothing renders`).toContain(target);
    }
  });

  it("keeps all four primary nav items pointing somewhere, never at a bare #", () => {
    for (const label of ["Home", "Why Sendloom", "Workflow", "Contact"]) {
      expect(NAV_SOURCE).toContain(`label: "${label}"`);
    }

    // A bare "#" is the classic placeholder that looks wired and is not.
    expect(NAV_SOURCE).not.toMatch(/href:\s*["'`]#["'`]/);
    expect(PAGE_SOURCE).not.toMatch(/href=["'`]#["'`]/);
  });

  it("routes the auth calls to action at real pages", () => {
    expect(NAV_SOURCE).toContain('href="/login"');
    expect(NAV_SOURCE).toContain('href="/signup"');
    expect(PAGE_SOURCE).toContain('href="/signup"');
  });

  it("marks the active section for assistive tech, not colour alone", () => {
    expect(NAV_SOURCE).toContain("aria-current");
    expect(NAV_SOURCE).toContain("navLinkActive");
  });

  it("lets the keyboard close the mobile menu", () => {
    expect(NAV_SOURCE).toContain('"Escape"');
    expect(NAV_SOURCE).toContain("toggleRef.current?.focus()");
  });
});

describe("landing integration marks", () => {
  const MARKS_SOURCE = readFileSync("src/components/marketing/integration-marks.tsx", "utf8");

  it("inlines the brand artwork instead of fetching silhouettes from a CDN", () => {
    expect(code(PAGE_SOURCE)).not.toContain("simpleicons.org");
    expect(code(MARKS_SOURCE)).not.toContain("simpleicons.org");
    // Masking a single-colour sprite is what flattened these to grey blobs.
    expect(code(MARKS_SOURCE)).not.toContain("maskImage");
    expect(code(PAGE_SOURCE)).not.toContain("maskImage");
    // Real artwork means real fills, not one currentColor silhouette.
    expect(MARKS_SOURCE).toContain('fill="#4caf50"');
  });

  it("keeps every integration named for screen readers", () => {
    for (const name of ["Gmail", "Google Workspace", "Google Sheets", "Microsoft Excel", "Google Drive"]) {
      expect(MARKS_SOURCE).toContain(`name: "${name}"`);
    }
  });
});

describe("landing Imports window", () => {
  const importsStart = PAGE_SOURCE.indexOf('<article key="imports"');
  const discoverStart = PAGE_SOURCE.indexOf('<article key="discover"');
  const importsWindow = PAGE_SOURCE.slice(importsStart, discoverStart);

  it("keeps the compact four-row mapping preview clear of its footer", () => {
    expect(importsWindow).toContain('["company", "Company"]');
    expect(importsWindow).not.toContain('["location", "Location"]');
    expect(importsWindow).toContain("4 of 4 mapped");
  });
});

describe("landing production fallback", () => {
  it("keeps the original production CSP without the development eval exception", () => {
    expect(NEXT_CONFIG).toContain('"script-src \'self\' \'unsafe-inline\'"');
    expect(NEXT_CONFIG).not.toContain("unsafe-eval");
  });

  it("pairs story copy and demos on desktop when the animated deck is unavailable", () => {
    expect(LANDING_CSS).toContain('.dataStory:not([data-story="enhanced"]) .dataStage');
    expect(LANDING_CSS).toMatch(/dataStory:not\(\[data-story="enhanced"\]\) \.dataStage[\s\S]{0,240}grid-template-columns/);
    expect(LANDING_CSS).toContain('.dataStory:not([data-story="enhanced"]) .dataStep');
    expect(LANDING_CSS).toContain('.dataStory:not([data-story="enhanced"]) .dataCard');
  });
});
