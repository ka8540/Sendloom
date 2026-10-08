import { describe, expect, it } from "vitest";

import { buildMergePayload } from "@/lib/mapping";
import { assertUniqueTemplateFieldNames, normalizeTemplateFieldName } from "@/lib/template-fields";
import { renderTemplate } from "@/lib/templates";

describe("template field names", () => {
  it.each([
    ["FIRST_NAME", "first_name"],
    ["First_Name", "first_name"],
    ["first_name", "FIRST_NAME"],
    ["FiRsT_NaMe", "First_Name"]
  ])("matches %s to %s without changing stored casing", (variable, column) => {
    const row = { [column]: "John" };
    const mapping = { variableMap: { [column]: column } };
    const payload = buildMergePayload(row, mapping);

    expect(row).toEqual({ [column]: "John" });
    expect(mapping.variableMap).toEqual({ [column]: column });
    expect(renderTemplate(`Hi {{${variable}}}`, payload)).toBe("Hi John");
  });

  it("keeps unrelated field names distinct", () => {
    expect(normalizeTemplateFieldName(" first_name ")).toBe("first_name");
    expect(normalizeTemplateFieldName("FIRST_NAME")).not.toBe(normalizeTemplateFieldName("firstname"));
    expect(normalizeTemplateFieldName("first-name")).not.toBe(normalizeTemplateFieldName("first_name"));
    expect(normalizeTemplateFieldName("first name")).not.toBe(normalizeTemplateFieldName("first_name"));
    expect(renderTemplate("{{FIRST_NAME}}", { last_name: "Doe" })).toBe("");
  });

  it("rejects ambiguous casing instead of choosing one value", () => {
    expect(() => assertUniqueTemplateFieldNames(["first_name", "FIRST_NAME"])).toThrow(/Ambiguous template fields/);
    expect(() => renderTemplate("{{first_name}}", { first_name: "John", FIRST_NAME: "Jane" })).toThrow(
      /Ambiguous template fields/
    );
  });
});
