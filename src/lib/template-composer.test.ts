import { describe, expect, it } from "vitest";

import { applyTemplateComposerCommand, insertTemplateAttribute } from "@/lib/template-composer";

describe("template composer", () => {
  it("wraps selected plain text with lightweight formatting markers", () => {
    const edit = applyTemplateComposerCommand("PLAIN_TEXT", "Hello there", 6, 11, "bold");

    expect(edit.value).toBe("Hello **there**");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("there");
  });

  it("turns pasted lines into a numbered plain-text list", () => {
    const value = "First step\n- Second step";
    const edit = applyTemplateComposerCommand("PLAIN_TEXT", value, 0, value.length, "numbered-list");

    expect(edit.value).toBe("1. First step\n2. Second step");
  });

  it("uses real HTML elements for HTML template formatting", () => {
    const edit = applyTemplateComposerCommand("HTML", "Read more", 0, 9, "link");

    expect(edit.value).toBe('<a href="https://example.com">Read more</a>');
  });

  it("leaves structured JSON unchanged when formatting is requested", () => {
    const value = '{"message":"Hello"}';
    const edit = applyTemplateComposerCommand("JSON", value, 12, 17, "italic");

    expect(edit.value).toBe(value);
  });

  it("inserts merge attributes at the current selection", () => {
    const edit = insertTemplateAttribute("Hi ,", 3, 3, "first_name");

    expect(edit.value).toBe("Hi {{first_name}},");
  });
});
