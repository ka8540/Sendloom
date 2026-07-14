import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Node-only source assertions for the redesigned Create Sequence builder page
// (server components are not renderable in the node test env). Covers the
// builder header + numbered workflow steps, every existing field, the compact
// attachment composer, the compact non-sticky Send from Gmail panel, and the
// unchanged create flow.

const CREATE_PAGE = readFileSync("src/app/(app)/campaigns/new/page.tsx", "utf8");
const CREATE_PAGE_CSS = readFileSync("src/app/(app)/campaigns/new/page.module.css", "utf8");
const BUILDER = readFileSync("src/components/campaign-builder.tsx", "utf8");
const BUILDER_CSS = readFileSync("src/components/campaign-builder.module.css", "utf8");
const BACK_BUTTON = readFileSync("src/components/back-button.tsx", "utf8");
const BOUNCE_STATUS = readFileSync("src/components/senders/bounce-monitoring-status.tsx", "utf8");

describe("Create Sequence page structure", () => {
  it("renders the builder page with its header and workflow steps (#1)", () => {
    expect(CREATE_PAGE).toContain("export default async function NewSequencePage");
    expect(CREATE_PAGE).toContain("<CampaignBuilder");
    expect(CREATE_PAGE).toContain("Create a sequence");
    expect(CREATE_PAGE).toContain("Pick your audience, template, sender, and launch timing.");
    // The form is organized as numbered steps, not one flat field list.
    expect(BUILDER).toContain("styles.steps");
    for (const stepTitle of ["Basics", "Audience", "Message", "Sender", "Attachments", "Timing"]) {
      expect(BUILDER).toContain(`<h2 className={styles.stepTitle}>${stepTitle}</h2>`);
    }
    // Step numbers are decorative; the list semantics carry the order.
    expect(BUILDER).toContain('<span className={styles.stepMarker} aria-hidden="true">1</span>');
    expect(BUILDER).toContain('<span className={styles.stepMarker} aria-hidden="true">6</span>');
  });

  it("the header workflow path is decorative only — no fake data", () => {
    expect(CREATE_PAGE).toContain('className={styles.flowPath} aria-hidden="true"');
    expect(CREATE_PAGE).toContain('["Audience", "Message", "Sender", "Timing"]');
  });
});

describe("Create Sequence back control (#2, #3)", () => {
  it("does not render a second visible Back to sequences control", () => {
    expect(CREATE_PAGE).not.toContain("Back to sequences");
    expect(CREATE_PAGE).not.toContain("styles.backLink");
    expect(CREATE_PAGE).not.toContain("<BackButton");
    expect(CREATE_PAGE).not.toContain('href="/campaigns"');
  });

  it("uses the icon-only app-shell back button for the sequences dashboard", () => {
    expect(BACK_BUTTON).toContain('pathname === "/campaigns/new"');
    expect(BACK_BUTTON).toContain('pathname === "/sequences/new"');
    expect(BACK_BUTTON).toContain('"Back to sequences"');
    expect(BACK_BUTTON).toContain('router.push("/sequences")');
    expect(BACK_BUTTON).toContain("aria-label={resolvedLabel}");
    expect(BACK_BUTTON).toContain('<ArrowLeft aria-hidden="true" />');
  });
});

describe("Create Sequence fields (#4–#10)", () => {
  it("keeps every field with its label, name, and id", () => {
    // Sequence name (#4)
    expect(BUILDER).toContain('<label htmlFor="campaign-name">Sequence name</label>');
    expect(BUILDER).toContain('<input id="campaign-name" name="name" placeholder="April founder outreach" required />');
    // Contact list (#5)
    expect(BUILDER).toContain('<label htmlFor="importId">Contact list</label>');
    expect(BUILDER).toContain('id="importId"');
    expect(BUILDER).toContain('name="importId"');
    expect(BUILDER).toContain('<input type="hidden" name="mappingId" value={selectedMappingId} />');
    // Email template (#6)
    expect(BUILDER).toContain('<label htmlFor="templateId">Email template</label>');
    expect(BUILDER).toContain('<select id="templateId" name="templateId"');
    // Send from (#7)
    expect(BUILDER).toContain('<label htmlFor="senderProfileId">Send from</label>');
    expect(BUILDER).toContain('<select id="senderProfileId" name="senderProfileId"');
    // Send timing (#9)
    expect(BUILDER).toContain('<label htmlFor="scheduleType">When should this send?</label>');
    for (const option of ["Right away", "Schedule once", "Repeat on a schedule"]) {
      expect(BUILDER).toContain(option);
    }
    // Create button (#10)
    expect(BUILDER).toContain('type="submit"');
    expect(BUILDER).toContain("Create sequence");
    expect(BUILDER).toContain("Preparing sequence...");
  });

  it("renders the compact attachments section with the same input (#8)", () => {
    expect(BUILDER).toContain("Optional attachments");
    expect(BUILDER).toContain('htmlFor="attachments"');
    expect(BUILDER).toContain('id="attachments"');
    expect(BUILDER).toContain('accept=".pdf,.doc,.docx,.txt,.rtf"');
    expect(BUILDER).toContain("multiple");
    expect(BUILDER).toContain("mergeAttachmentFiles");
    // Add files stays a real, keyboard-focusable button.
    expect(BUILDER).toMatch(/<button\s+type="button"\s+className=\{styles\.addButton\}/);
    expect(BUILDER).toContain("Add files");
    // Count chip + compact supported-types footer instead of bulky copy.
    expect(BUILDER).toContain("styles.attachmentCount");
    expect(BUILDER).toContain("PDF, DOC, DOCX, TXT, or RTF · up to 10 MB each");
    // File rows keep accessible remove actions.
    expect(BUILDER).toContain("aria-label={`Remove ${attachment.name}`}");
  });

  it("keeps validation-affecting attributes on required fields", () => {
    const requiredFields = BUILDER.match(/required/g) ?? [];
    // name, importId, templateId, senderProfileId, scheduledFor, time
    expect(requiredFields.length).toBeGreaterThanOrEqual(6);
    expect(BUILDER).toContain("disabled={state.pending || !canCreateSequence}");
    expect(BUILDER).toContain("Select at least one day.");
    expect(BUILDER).toContain("Choose a future date and time in the selected timezone.");
  });
});

describe("Send from Gmail panel (#11–#14)", () => {
  it("renders the Gmail card with its existing actions", () => {
    expect(CREATE_PAGE).toContain('className={styles.senderPanel} aria-label="Send from Gmail"');
    expect(CREATE_PAGE).toContain("Send from Gmail");
    expect(CREATE_PAGE).toContain("styles.senderChip}>Connected</span>");
    expect(CREATE_PAGE).toContain("Connect another Gmail");
    expect(CREATE_PAGE).toContain("<BounceMonitoringStatus");
    expect(BOUNCE_STATUS).toContain("Sync recent delivery failures");
    expect(BOUNCE_STATUS).toContain("Bounce monitoring active");
  });

  it("shows only real sender data — the count chip comes from connected senders", () => {
    expect(CREATE_PAGE).toContain("connectedSenders.length");
    expect(CREATE_PAGE).toContain("resolveBounceMonitoringStatus(sender)");
  });

  it("does not make the sender panel sticky or fixed (#14)", () => {
    const senderPanelRule = CREATE_PAGE_CSS.match(/\/\* The sender panel[\s\S]*?\.senderPanel \{[^}]*\}/);
    expect(senderPanelRule).not.toBeNull();
    expect(senderPanelRule![0]).toContain("align-self: start;");
    expect(senderPanelRule![0]).not.toMatch(/position:\s*(?:sticky|fixed)/);
    expect(CREATE_PAGE_CSS).not.toMatch(/position:\s*(?:sticky|fixed)/);
  });
});

describe("create flow unchanged (#15)", () => {
  it("submits through the same API with the same payload shape", () => {
    expect(BUILDER).toContain("onSubmit={onSubmit}");
    expect(BUILDER).toContain('fetch("/api/campaigns"');
    expect(BUILDER).toContain('method: "POST"');
    expect(BUILDER).toContain('formData.append("attachments", attachment)');
    expect(BUILDER).toContain('formData.set("scheduleRule", JSON.stringify(scheduleRule))');
    expect(BUILDER).toContain('formData.set("autoLaunch", String(autoLaunch))');
    expect(BUILDER).toContain("SEQUENCE_STORAGE_LIMIT_CODE");
    expect(BUILDER).toContain("SEQUENCE_CONCURRENCY_LIMIT_CODE");
    expect(BUILDER).toContain("<SequenceLimitDialog");
    expect(BUILDER).toContain("wait-for-slot");
  });

  it("the page only reads data — no mutations, no schema changes (#18)", () => {
    expect(CREATE_PAGE).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
    expect(CREATE_PAGE).toContain("prisma.import.findMany");
    expect(CREATE_PAGE).toContain("prisma.senderProfile.findMany");
  });
});

describe("accessibility and motion", () => {
  it("weekday chips expose pressed state; focus states are visible", () => {
    expect(BUILDER).toContain("aria-pressed={selected}");
    expect(BUILDER).toContain('aria-label="Recurring weekdays"');
    expect(BUILDER_CSS).toContain(":focus-visible");
    expect(CREATE_PAGE_CSS).not.toMatch(/outline:\s*none\s*;?\s*\}/);
  });

  it("status notes pair icons with text — color is not the only indicator", () => {
    expect(BUILDER).toContain('data-tone="warning"');
    expect(BUILDER).toContain("<TriangleAlert");
    expect(BOUNCE_STATUS).toContain("StatusIcon");
  });

  it("respects reduced motion", () => {
    const reduced = BUILDER_CSS.slice(BUILDER_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/transition:\s*none/);
  });

  it("adds no heavy animation or chart libraries", () => {
    for (const source of [CREATE_PAGE, BUILDER, CREATE_PAGE_CSS, BUILDER_CSS]) {
      expect(source).not.toMatch(/three|gsap|lottie|framer-motion|canvas|webgl/i);
    }
  });
});
