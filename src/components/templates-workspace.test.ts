import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const WORKSPACE = readFileSync("src/components/templates-workspace.tsx", "utf8");
const FORM = readFileSync("src/components/forms.tsx", "utf8");
const STYLES = readFileSync("src/app/globals.css", "utf8");

describe("templates library and creation wizard", () => {
  it("keeps the default templates route focused on the saved library", () => {
    expect(WORKSPACE).toContain("Create new template");
    expect(WORKSPACE).toContain("Saved templates");
    expect(WORKSPACE).toContain("Search templates...");
    expect(WORKSPACE).toContain("templates-pagination");
    expect(WORKSPACE).not.toContain("Live preview");
  });

  it("opens create and edit work in a separate three-step wizard state", () => {
    expect(WORKSPACE).toContain("if (wizardOpen)");
    expect(WORKSPACE).toContain("handleStartCreating");
    expect(WORKSPACE).toContain("handleStartEditing");
    expect(WORKSPACE).toContain("Back to templates");
    expect(FORM).toMatch(/TEMPLATE_WIZARD_STEPS\s*=\s*\[\s*"Compose",\s*"Optimize",\s*"Preview"/);
  });

  it("keeps writing tools in Compose and optimization tools in Optimize", () => {
    const composeStep = FORM.slice(FORM.indexOf("{activeStep === 0 ? ("), FORM.indexOf("{activeStep === 1 ? ("));
    const optimizeStep = FORM.slice(FORM.indexOf("{activeStep === 1 ? ("), FORM.indexOf("{activeStep === 2 ? ("));

    expect(composeStep).toContain("Opening email composer");
    expect(composeStep).toContain("Insert attribute");
    expect(composeStep).toContain("Words:");
    expect(composeStep).not.toContain("AI copy assistant");
    expect(composeStep).not.toContain("Run spam check");
    expect(optimizeStep).toContain("AI copy assistant");
    expect(optimizeStep).toContain("Run spam check");
  });

  it("uses the sanitized preview renderer and returns saved templates to the library", () => {
    expect(FORM).toMatch(/renderTemplatePreview\(\s*fields\.format/);
    expect(FORM).toMatch(/renderTemplateSubjectPreview\(\s*fields\.subject/);
    expect(FORM).toContain("activeStep === 2");
    expect(FORM).toContain("Create template");
    expect(WORKSPACE).toContain('router.replace("/templates")');
    expect(WORKSPACE).toContain("setWizardOpen(false)");
  });

  it("provides responsive wizard, progress, and library styles", () => {
    expect(STYLES).toContain(".templates-library__hero");
    expect(STYLES).toContain(".template-wizard__steps");
    expect(STYLES).toContain(".template-wizard__progress");
    expect(STYLES).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.template-wizard/);
  });
});
