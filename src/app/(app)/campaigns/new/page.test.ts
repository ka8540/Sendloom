import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIENCE_LIMIT,
  WIZARD_STEPS,
  filterAudienceOptions,
  filterTemplateOptions,
  isAudienceStepComplete,
  isTimingStepComplete,
  type AudienceOption,
  type TemplateOption
} from "@/components/campaign-builder-wizard";

const CREATE_PAGE = readFileSync("src/app/(app)/campaigns/new/page.tsx", "utf8");
const CREATE_PAGE_CSS = readFileSync("src/app/(app)/campaigns/new/page.module.css", "utf8");
const BUILDER = readFileSync("src/components/campaign-builder.tsx", "utf8");
const BUILDER_CSS = readFileSync("src/components/campaign-builder.module.css", "utf8");
const BACK_BUTTON = readFileSync("src/components/back-button.tsx", "utf8");
const BOUNCE_STATUS = readFileSync("src/components/senders/bounce-monitoring-status.tsx", "utf8");
const DASHBOARD = readFileSync("src/app/(app)/campaigns/sequence-dashboard.tsx", "utf8");
const DETAIL_PAGE = readFileSync("src/app/(app)/campaigns/[id]/page.tsx", "utf8");

const audiences: AudienceOption[] = [
  { id: "founders", label: "Founder prospects.csv", rowCount: 42, mappedFields: ["email", "first_name"] },
  { id: "designers", label: "Design leaders.csv", rowCount: 17, mappedFields: ["email", "job_title"] }
];

const manyAudiences: AudienceOption[] = [
  { id: "latest-1", label: "Latest founders.csv", rowCount: 10, mappedFields: ["email"] },
  { id: "latest-2", label: "Latest engineers.csv", rowCount: 20, mappedFields: ["email"] },
  { id: "latest-3", label: "Latest designers.csv", rowCount: 30, mappedFields: ["email"] },
  { id: "latest-4", label: "Latest recruiters.csv", rowCount: 40, mappedFields: ["email"] },
  { id: "latest-5", label: "Latest operators.csv", rowCount: 50, mappedFields: ["email"] },
  { id: "older-finance", label: "Legacy finance.csv", rowCount: 60, mappedFields: ["company", "role"] },
  { id: "older-sales", label: "Legacy sales.csv", rowCount: 70, mappedFields: ["email", "region"] }
];

const templates: TemplateOption[] = [
  {
    id: "plain",
    label: "Founder intro",
    formatLabel: "Plain text",
    subject: "A quick introduction",
    snippet: "Hi {{first_name}}, I wanted to reach out."
  },
  {
    id: "html",
    label: "Design follow-up",
    formatLabel: "HTML",
    subject: "Following up",
    snippet: "A polished follow-up for design leaders."
  }
];

describe("Create Sequence wizard structure", () => {
  it("renders a four-step wizard instead of the previous stacked form", () => {
    expect(CREATE_PAGE).toContain("<CampaignBuilder");
    expect(BUILDER).toContain('useState<WizardStep>(0)');
    expect(WIZARD_STEPS).toEqual(["Audience", "Message", "Timing", "Review"]);
    expect(BUILDER).toContain('aria-label="Sequence creation progress"');
    expect(BUILDER).toContain('aria-current={isActive ? "step" : undefined}');
    expect(BUILDER).not.toContain("styles.steps");
    expect(BUILDER).not.toContain("Basics</h2>");
  });

  it("mounts only the active step content", () => {
    expect(BUILDER).toContain("activeStep === 0 ? (");
    expect(BUILDER).toContain("activeStep === 1 ? (");
    expect(BUILDER).toContain("activeStep === 2 ? (");
    expect(BUILDER).toContain("activeStep === 3 ? (");
    for (const label of ["Audience step", "Message step", "Timing step", "Review step"]) {
      expect(BUILDER).toContain(`aria-label="${label}"`);
    }
  });

  it("does not allow the progress indicator to skip a future step", () => {
    expect(BUILDER).toContain("if (step <= activeStep) return true;");
    expect(BUILDER).toContain("if (step !== activeStep + 1) return false;");
  });

  it("moves focus to the active step heading and keeps controls keyboard accessible", () => {
    expect(BUILDER).toContain("stepHeadingRef.current?.focus()");
    expect(BUILDER).toContain("ref={stepHeadingRef} tabIndex={-1}");
    expect(BUILDER).toContain('type="button"');
    expect(BUILDER_CSS).toContain(":focus-visible");
  });
});

describe("Step 1: Audience", () => {
  it("renders one closed-by-default audience combobox with its search inside the dropdown", () => {
    expect(BUILDER).toContain('<label htmlFor="campaign-name">Sequence name</label>');
    expect(BUILDER).toContain('id="audience-selector-label">Audience</span>');
    expect(BUILDER).toContain('role="combobox"');
    expect(BUILDER).toContain('aria-expanded={audienceMenuOpen}');
    expect(BUILDER).toContain('aria-controls="audience-options-menu"');
    expect(BUILDER).toContain('"Choose an audience"');
    expect(BUILDER).toContain('{audienceMenuOpen ? (');
    expect(BUILDER).toContain('placeholder="Search contact lists"');
    expect(BUILDER).toContain('aria-label="Available contact lists"');
    expect(BUILDER).toContain('role="listbox"');
    expect(BUILDER).toContain('role="option"');
    expect(BUILDER).toContain("audience.rowCount");
    expect(BUILDER).toContain("audience.mappedFields");
    expect(BUILDER).toContain("Import or add a new CSV");
    expect(BUILDER).toContain("No contact lists yet");
    expect(BUILDER).toContain('href="/imports"');
  });

  it("does not render audience cards or an inline list while the selector is closed", () => {
    expect(BUILDER).not.toContain("styles.optionList");
    expect(BUILDER).not.toContain("styles.optionCard}${selected");
    expect(BUILDER_CSS).not.toContain(".optionCard {");
    expect(BUILDER).toContain("const [audienceMenuOpen, setAudienceMenuOpen] = useState(false)");
    expect(BUILDER_CSS).toMatch(/\.audienceMenu\s*\{[^}]*position:\s*absolute;/s);
  });

  it("shows only the latest five audiences when search is empty", () => {
    expect(DEFAULT_AUDIENCE_LIMIT).toBe(5);
    expect(filterAudienceOptions(manyAudiences, "").map((entry) => entry.id)).toEqual([
      "latest-1",
      "latest-2",
      "latest-3",
      "latest-4",
      "latest-5"
    ]);
    expect(CREATE_PAGE).toContain('orderBy: { createdAt: "desc" }');
    expect(BUILDER).toContain("Showing latest {DEFAULT_AUDIENCE_LIMIT}. Search to find older lists.");
    expect(BUILDER).toContain("!audienceMenuOpen && hasImports && !hasAudienceQuery && hasOlderAudiences");
  });

  it("searches every audience by list name and mapped personalization field", () => {
    expect(filterAudienceOptions(audiences, "founder").map((entry) => entry.id)).toEqual(["founders"]);
    expect(filterAudienceOptions(audiences, "job_title").map((entry) => entry.id)).toEqual(["designers"]);
    expect(filterAudienceOptions(manyAudiences, "legacy finance").map((entry) => entry.id)).toEqual(["older-finance"]);
    expect(filterAudienceOptions(manyAudiences, "region").map((entry) => entry.id)).toEqual(["older-sales"]);
  });

  it("returns to the latest five after search clears without clearing selection state", () => {
    expect(filterAudienceOptions(manyAudiences, "legacy")).toHaveLength(2);
    expect(filterAudienceOptions(manyAudiences, "  ")).toEqual(manyAudiences.slice(0, 5));
    expect(BUILDER).toContain("const [selectedImportId, setSelectedImportId] = useState(\"\")");
    expect(BUILDER).toContain("setAudienceQuery(event.target.value)");
    expect(BUILDER).not.toContain("setSelectedImportId(event.target.value)");
  });

  it("selects an audience, closes the dropdown, and summarizes the preserved value in the field", () => {
    const audienceOption = BUILDER.slice(
      BUILDER.indexOf("className={`${styles.audienceOption}"),
      BUILDER.indexOf("</button>", BUILDER.indexOf("className={`${styles.audienceOption}"))
    );
    expect(audienceOption).toContain("setSelectedImportId(audience.id)");
    expect(audienceOption).toContain("closeAudienceMenu(true)");
    expect(BUILDER).toContain("selectedImport?.label");
    expect(BUILDER).toContain("selectedImport.mappedFields.slice(0, 2)");
    expect(BUILDER).toContain("+{selectedImport.mappedFields.length - 2} fields");

    const changeStepBody = BUILDER.slice(BUILDER.indexOf("function changeStep"), BUILDER.indexOf("function canOpenStep"));
    expect(changeStepBody).not.toContain("setSelectedImportId");
  });

  it("renders compact helper and requested empty states without hiding the import CTA", () => {
    expect(BUILDER).toContain("hasOlderAudiences");
    expect(BUILDER).toContain("No matching audiences");
    expect(BUILDER).toContain("Try another list name or mapped field.");
    expect(BUILDER).toContain("No contact lists yet");
    expect(BUILDER).toContain("Import a CSV to create your first audience.");
    expect(BUILDER.match(/Import or add a new CSV/g)).toHaveLength(1);
    expect(BUILDER).toContain("disabled={!hasImports}");
    expect(BUILDER_CSS).toContain("overscroll-behavior: contain;");
  });

  it("keeps Next disabled until name, audience, and its saved mapping are present", () => {
    expect(isAudienceStepComplete("", "founders", "mapping-1")).toBe(false);
    expect(isAudienceStepComplete("Sequence", "", "mapping-1")).toBe(false);
    expect(isAudienceStepComplete("Sequence", "founders", "")).toBe(false);
    expect(isAudienceStepComplete("Sequence", "founders", "mapping-1")).toBe(true);
    expect(BUILDER).toContain("disabled={!audienceStepComplete}");
  });
});

describe("Step 2: Message", () => {
  it("shows the selected audience summary and searchable template cards after Next", () => {
    expect(BUILDER).toContain("changeStep(1)");
    expect(BUILDER).toContain('<label htmlFor="template-search">Search templates</label>');
    expect(BUILDER).toContain('aria-label="Available email templates"');
    expect(BUILDER).toContain("template.formatLabel");
    expect(BUILDER).toContain("template.subject");
    expect(BUILDER).toContain("template.snippet");
    expect(BUILDER).toContain("No email templates yet");
  });

  it("filters templates by name, format, subject, and preview content", () => {
    expect(filterTemplateOptions(templates, "founder").map((entry) => entry.id)).toEqual(["plain"]);
    expect(filterTemplateOptions(templates, "HTML").map((entry) => entry.id)).toEqual(["html"]);
    expect(filterTemplateOptions(templates, "polished").map((entry) => entry.id)).toEqual(["html"]);
    expect(filterTemplateOptions(templates, "introduction").map((entry) => entry.id)).toEqual(["plain"]);
  });

  it("requires a template before moving to timing", () => {
    expect(BUILDER).toContain("disabled={!selectedTemplateId}");
    expect(BUILDER).toContain("onClick={() => changeStep(2)}");
  });
});

describe("Step 3: Timing", () => {
  it("keeps all existing timing choices and attachments", () => {
    for (const option of ["Right away", "Schedule once", "Repeat on a schedule"]) {
      expect(BUILDER).toContain(option);
    }
    expect(BUILDER).toContain("scheduledFor-control");
    expect(BUILDER).toContain("scheduleTimeZone-control");
    expect(BUILDER).toContain("frequency-control");
    expect(BUILDER).toContain('aria-label="Recurring weekdays"');
    expect(BUILDER).toContain("Optional attachments");
    expect(BUILDER).toContain('accept=".pdf,.doc,.docx,.txt,.rtf"');
    expect(BUILDER).toContain("mergeAttachmentFiles");
  });

  it("requires the timing-specific values before Review", () => {
    expect(isTimingStepComplete({ scheduleType: "immediate", scheduledFor: "", sendTime: "", frequency: "weekly", selectedWeekdays: [] })).toBe(true);
    expect(isTimingStepComplete({ scheduleType: "once", scheduledFor: "", sendTime: "09:00", frequency: "weekly", selectedWeekdays: [1] })).toBe(false);
    expect(isTimingStepComplete({ scheduleType: "once", scheduledFor: "2026-08-01T09:00", sendTime: "", frequency: "weekly", selectedWeekdays: [] })).toBe(true);
    expect(isTimingStepComplete({ scheduleType: "recurring", scheduledFor: "", sendTime: "09:00", frequency: "weekly", selectedWeekdays: [] })).toBe(false);
    expect(BUILDER).toContain("disabled={!timingStepComplete}");
  });
});

describe("Step 4: Review and create", () => {
  it("summarizes every selected value and exposes the final create action", () => {
    for (const label of ["Sequence name", "Audience", "Template", "Sender email", "Timing", "Attachments"]) {
      expect(BUILDER).toContain(`<dt>${label}</dt>`);
    }
    expect(BUILDER).toContain('aria-label="Review step"');
    expect(BUILDER).toContain('type="submit"');
    expect(BUILDER).toContain("Create sequence");
    expect(BUILDER).toContain("Preparing sequence...");
  });

  it("preserves controlled values when moving Back and Next", () => {
    for (const stateName of ["sequenceName", "selectedImportId", "selectedTemplateId", "selectedSenderId", "scheduleType", "attachments"]) {
      expect(BUILDER).toContain(stateName);
    }
    const changeStepBody = BUILDER.slice(BUILDER.indexOf("function changeStep"), BUILDER.indexOf("function canOpenStep"));
    expect(changeStepBody).toContain("setActiveStep(nextStep)");
    expect(changeStepBody).not.toMatch(/setSequenceName|setSelectedImportId|setSelectedTemplateId|setSelectedSenderId|setAttachments/);
  });
});

describe("compact sender selector", () => {
  it("replaces the large server card with a compact selector beside the wizard", () => {
    expect(CREATE_PAGE).not.toContain("styles.senderPanel");
    expect(CREATE_PAGE).not.toContain("Send from Gmail");
    expect(BUILDER).toContain('className={styles.senderSelector} aria-label="Sender selection"');
    expect(BUILDER).toContain('<label htmlFor="senderProfileId">Send from</label>');
    expect(BUILDER).toContain('aria-label="Send from connected Gmail account"');
    expect(BUILDER).toContain("selectedSender.email");
    expect(BUILDER).toContain("Connected");
  });

  it("keeps Gmail connection and bounce-sync actions available", () => {
    expect(BUILDER).toContain("Connect another Gmail");
    expect(BUILDER).toContain("<BounceMonitoringStatus");
    expect(BOUNCE_STATUS).toContain("Sync recent delivery failures");
    expect(BUILDER).toContain("Reconnect Gmail");
  });

  it("is compact, responsive, and never sticky or fixed", () => {
    const senderRule = BUILDER_CSS.slice(
      BUILDER_CSS.indexOf("/* Compact sender selector"),
      BUILDER_CSS.indexOf(".senderHeading")
    );
    expect(senderRule).toContain("align-self: start;");
    expect(senderRule).not.toMatch(/position:\s*(?:sticky|fixed)/);
    expect(BUILDER_CSS).not.toMatch(/position:\s*(?:sticky|fixed)/);
    expect(BUILDER_CSS).toContain("@media (max-width: 1024px)");
    expect(BUILDER_CSS).toContain("grid-template-columns: minmax(0, 1fr);");
  });
});

describe("create behavior and scope guards", () => {
  it("submits the same field names, attachments, schedule payload, and API call", () => {
    for (const name of ["name", "importId", "mappingId", "templateId", "senderProfileId", "scheduleType", "scheduledFor", "scheduleTimeZone", "frequency", "time"]) {
      expect(BUILDER).toContain(`name="${name}"`);
    }
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

  it("does not move wizard code into the sequence dashboard or detail page", () => {
    for (const source of [DASHBOARD, DETAIL_PAGE]) {
      expect(source).not.toContain("WIZARD_STEPS");
      expect(source).not.toContain("campaign-builder-wizard");
      expect(source).not.toContain("senderSelector");
    }
  });

  it("adds no backend mutation, schema code, heavy library, or second back control", () => {
    expect(CREATE_PAGE).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
    expect(CREATE_PAGE).toContain("prisma.import.findMany");
    expect(CREATE_PAGE).toContain("prisma.senderProfile.findMany");
    expect(CREATE_PAGE).not.toContain("Back to sequences");
    expect(BACK_BUTTON).toContain('router.push("/sequences")');
    for (const source of [CREATE_PAGE, CREATE_PAGE_CSS, BUILDER, BUILDER_CSS]) {
      expect(source).not.toMatch(/three|gsap|lottie|framer-motion|canvas|webgl/i);
    }
  });

  it("respects reduced motion", () => {
    const reduced = BUILDER_CSS.slice(BUILDER_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("transition: none;");
    expect(reduced).toContain("animation: none;");
  });
});
