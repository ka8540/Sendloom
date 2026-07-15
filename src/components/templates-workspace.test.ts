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

  it("opens create and edit work in a separate two-step wizard state", () => {
    expect(WORKSPACE).toContain("if (wizardOpen)");
    expect(WORKSPACE).toContain("handleStartCreating");
    expect(WORKSPACE).toContain("handleStartEditing");
    expect(FORM).toContain("Back to templates");
    expect(FORM).toContain("onCancel?.()");
    expect(FORM).toMatch(/TEMPLATE_WIZARD_STEPS\s*=\s*\[\s*"Compose",\s*"Preview \/ Review"/);
    expect(FORM).not.toContain("Optimize your message");
  });

  it("keeps the working message controls together in Compose", () => {
    const composeStep = FORM.slice(FORM.indexOf("{activeStep === 0 ? ("), FORM.indexOf("{activeStep === 1 ? ("));

    expect(composeStep).toContain("template-form-toolbar");
    expect(composeStep).toContain("Check spam");
    expect(composeStep).toContain('enhanceText("subject"');
    expect(composeStep).toContain('enhanceText("body"');
    expect(composeStep).toContain("Template name");
    expect(composeStep).toContain("Message format");
    expect(composeStep).toContain("Subject");
    expect(composeStep).toContain("getTemplateBodyLabel");
    expect(composeStep).toContain("Next: Preview");
    expect(composeStep).toContain("Back to templates");
    expect(FORM).not.toContain("template-composer__toolbar");
    expect(FORM).not.toContain("Image attachments");
    expect(FORM).not.toContain("Video attachments");
    expect(FORM).not.toContain("File attachments");
    expect(FORM).not.toContain("A/B test");
    expect(FORM).not.toContain("Opening email composer");
  });

  it("uses the sanitized preview renderer and returns saved templates to the library", () => {
    expect(FORM).toMatch(/renderTemplatePreview\(\s*fields\.format/);
    expect(FORM).toMatch(/renderTemplateSubjectPreview\(\s*fields\.subject/);
    expect(FORM).toContain("activeStep === 1");
    expect(FORM).toContain("Template details");
    expect(FORM).toContain("Variables / merge fields");
    expect(FORM).toContain("Email preview");
    expect(FORM).toContain("Back to Compose");
    expect(FORM).toContain("Create template");
    expect(WORKSPACE).toContain('router.replace("/templates")');
    expect(WORKSPACE).toContain("setWizardOpen(false)");
  });

  it("provides responsive wizard, progress, and library styles", () => {
    expect(STYLES).toContain(".templates-library__hero");
    expect(STYLES).toContain(".template-wizard__steps");
    expect(STYLES).toContain(".template-wizard__progress");
    expect(STYLES).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(STYLES).not.toContain(".template-optimize-grid");
    expect(STYLES).not.toContain(".template-composer__toolbar");
    expect(STYLES).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.template-wizard/);
  });
});
