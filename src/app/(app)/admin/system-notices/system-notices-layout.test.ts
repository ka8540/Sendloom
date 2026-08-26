import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKSPACE = readFileSync(
  "src/app/(app)/admin/system-notices/system-notices-workspace.tsx",
  "utf8"
);
const STYLES = readFileSync(
  "src/app/(app)/admin/system-notices/system-notices.module.css",
  "utf8"
);

describe("system notice composer layout", () => {
  const composerStart = WORKSPACE.indexOf("styles.composerBody");
  const composerEnd = WORKSPACE.indexOf("confirmationOpen", composerStart);
  const composer = WORKSPACE.slice(composerStart, composerEnd);
  const noticeStart = composer.indexOf("styles.noticeDetailsSection");
  const deliveryStart = composer.indexOf("styles.deliverySection");
  const impactStart = composer.indexOf("styles.impactSection");
  const previewStart = composer.indexOf("styles.previewPane");
  const heroStart = WORKSPACE.indexOf("styles.hero");
  const metricsStart = WORKSPACE.indexOf("styles.metrics", heroStart);
  const noticeDetails = composer.slice(noticeStart, deliveryStart);
  const delivery = composer.slice(deliveryStart, impactStart);
  const impact = composer.slice(impactStart, previewStart);
  const hero = WORKSPACE.slice(heroStart, metricsStart);

  it("uses the established subdued action style for the new-notice button", () => {
    expect(hero).toContain("New notice");
    expect(hero).toContain("styles.secondaryButton");
    expect(hero).not.toContain("styles.primaryButton");
  });

  it("keeps all notice-detail fields full width with explicit label metadata", () => {
    expect(noticeStart).toBeGreaterThanOrEqual(0);
    expect(deliveryStart).toBeGreaterThan(noticeStart);
    expect(noticeDetails).toContain("Notice type");
    expect(noticeDetails).toContain("Email subject");
    expect(noticeDetails).toContain("Email title");
    expect(noticeDetails).toContain("Message");
    expect(noticeDetails).toContain("Affected area");
    const fieldOrder = [
      noticeDetails.indexOf("Notice type"),
      noticeDetails.indexOf("Email subject"),
      noticeDetails.indexOf("Email title"),
      noticeDetails.indexOf("Message"),
      noticeDetails.indexOf("Affected area")
    ];
    expect(fieldOrder).toEqual([...fieldOrder].sort((left, right) => left - right));
    expect(noticeDetails.match(/styles\.formField/g)).toHaveLength(5);
    expect(noticeDetails).toContain("styles.fieldMeta");
    expect(noticeDetails).toContain("styles.selectWrap");
    expect(noticeDetails).toContain("styles.noticeTypeSelect");
    expect(noticeDetails).toContain("styles.selectChevron");
    expect(STYLES).toMatch(/\.noticeFields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(STYLES).toMatch(/\.fieldLabel\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between/);
    expect(STYLES).toMatch(/\.selectWrap \.noticeTypeSelect\s*\{[^}]*appearance:\s*none;[^}]*padding-right:\s*2\.6rem;/);
    expect(STYLES).toMatch(/\.selectChevron\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/);
    expect(STYLES).not.toContain("float: right");
  });

  it("keeps delivery-specific UI full width and separate from impact dates", () => {
    expect(impactStart).toBeGreaterThan(deliveryStart);
    expect(delivery).toContain("styles.modeFieldset");
    expect(delivery).toContain("styles.segmented");
    expect(delivery).toContain("styles.sendNowInfo");
    expect(delivery).toContain("Send immediately");
    expect(delivery).toContain("styles.deliveryField");
    expect(delivery).toContain("Scheduled send");
    expect(delivery).not.toContain("impactStartsLocal");
    expect(delivery).not.toContain("impactEndsLocal");
    expect(STYLES).toMatch(/\.sendNowInfo\s*\{[^}]*width:\s*100%;/);
    expect(STYLES).toMatch(/\.segmented\s*\{[^}]*width:\s*100%;/);
    expect(STYLES).toMatch(/\.deliveryField,[\s\S]*?\.timezoneField\s*\{\s*width:\s*100%;/);
  });

  it("pairs impact dates in their own desktop grid and stacks them on phones", () => {
    expect(previewStart).toBeGreaterThan(impactStart);
    expect(impact).toContain("Impact window");
    expect(impact).toContain("styles.impactGrid");
    expect(impact).toContain("impactStartsLocal");
    expect(impact).toContain("impactEndsLocal");
    expect(impact).toContain("styles.timezoneField");
    expect(impact.indexOf("styles.timezoneField")).toBeGreaterThan(impact.indexOf("styles.impactGrid"));
    expect(STYLES).toMatch(/\.impactGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(STYLES).toMatch(/@media \(max-width:\s*680px\)[\s\S]*?\.impactGrid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it("keeps delivery actions reachable in a dedicated viewport footer", () => {
    expect(WORKSPACE).toContain("styles.composerFooter");
    expect(STYLES).toMatch(
      /\.composer\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/
    );
    expect(STYLES).toMatch(/\.composerFooter\s*\{[\s\S]*?border-top:[\s\S]*?padding:/);
  });

  it("matches the Discover primary and secondary action hierarchy", () => {
    expect(composer).toMatch(/styles\.secondaryButton[\s\S]*?Save (?:changes|draft)/);
    expect(composer).toMatch(/styles\.previewButton[\s\S]*?Preview exact email/);
    expect(composer).toMatch(/styles\.primaryButton[\s\S]*?Review send now[\s\S]*?Review schedule/);
    expect(STYLES).toMatch(
      /\.primaryButton\s*\{[^}]*border:\s*1px solid transparent;[^}]*background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-strong\)\);[^}]*color:\s*var\(--accent-contrast\);/
    );
    expect(STYLES).toMatch(
      /\.composerActions \.previewButton\s*\{[^}]*border-color:\s*var\(--line\);[^}]*background:\s*var\(--surface-strong\);[^}]*color:\s*var\(--text\);/
    );
    expect(STYLES).toMatch(
      /\.composerActions \.previewButton:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--field-focus\);[^}]*background:\s*var\(--surface-hover\);[^}]*transform:\s*translateY\(-1px\);/
    );
  });

  it("uses bounded scroll regions and exposes preview from the empty state", () => {
    expect(STYLES).toMatch(/\.composerBody\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
    expect(STYLES).toMatch(/\.formPane,[\s\S]*?\.previewPane\s*\{\s*overflow-y:\s*auto;/);
    expect(WORKSPACE).toMatch(/styles\.previewEmpty[\s\S]*?runPreview\(\)/);
  });

  it("preserves the exact-renderer preview and existing composer request paths", () => {
    expect(composer).toContain("styles.previewPane");
    expect(composer).toContain("srcDoc={preview.html}");
    expect(WORKSPACE).toContain('"/api/admin/system-notices/preview"');
    expect(WORKSPACE).toContain("payloadFromComposer(composer)");
    expect(WORKSPACE).toContain("beginConfirmation");
  });
});
