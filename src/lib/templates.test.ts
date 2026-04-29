import { describe, expect, it } from "vitest";

import {
  convertTemplateBody,
  extractTemplateVariables,
  renderTemplate,
  renderTemplatePreview,
  templateContentToPlainText,
  validateTemplateBody
} from "@/lib/templates";

describe("templates", () => {
  it("extracts merge variables", () => {
    expect(extractTemplateVariables("Hi {{name}} from {{company}}")).toEqual(["name", "company"]);
  });

  it("renders template variables", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Ari" })).toBe("Hi Ari");
  });

  it("renders plain text templates into preview HTML", () => {
    const preview = renderTemplatePreview("PLAIN_TEXT", "Hi {{name}},\n\nThanks for your time.", { name: "Ari" });
    expect(preview).toContain("<p>Hi Ari,</p>");
    expect(preview).toContain("<p>Thanks for your time.</p>");
  });

  it("renders plain text bullets and numbered items into real lists", () => {
    const preview = renderTemplatePreview(
      "PLAIN_TEXT",
      "Hi {{name}},\n\nHere are the next steps:\n1. Review the sheet\n2. Approve the copy\n\n- Keep the tone natural\n- Send me your notes",
      { name: "Ari" }
    );

    expect(preview).toContain("<p>Hi Ari,</p>");
    expect(preview).toContain("<ol><li>Review the sheet</li><li>Approve the copy</li></ol>");
    expect(preview).toContain("<ul><li>Keep the tone natural</li><li>Send me your notes</li></ul>");
  });

  it("renders JSON templates into preview HTML", () => {
    const preview = renderTemplatePreview(
      "JSON",
      JSON.stringify({ greeting: "Hi {{name}}", cta: "Would it make sense to connect?" }),
      { name: "Ari" }
    );
    expect(preview).toContain("Hi Ari");
    expect(preview).toContain("Would it make sense to connect?");
  });

  it("converts HTML templates to plain text and validates JSON content", () => {
    expect(templateContentToPlainText("HTML", "<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
    expect(validateTemplateBody("JSON", "{bad json")).toContain("valid JSON");
  });

  it("can convert plain text into JSON template content", () => {
    const converted = convertTemplateBody("Hi {{name}},\n\nI noticed {{company}}.", "PLAIN_TEXT", "JSON");
    expect(converted).toContain("\"intro\"");
    expect(converted).toContain("{{name}}");
  });

  it("can convert plain text lists into HTML lists", () => {
    const converted = convertTemplateBody("1. First step\n2. Second step\n\n- Final note", "PLAIN_TEXT", "HTML");
    expect(converted).toContain("<ol><li>First step</li><li>Second step</li></ol>");
    expect(converted).toContain("<ul><li>Final note</li></ul>");
  });
});
