import { describe, expect, it } from "vitest";

import { extractTemplateVariables, renderTemplate } from "@/lib/templates";

describe("templates", () => {
  it("extracts merge variables", () => {
    expect(extractTemplateVariables("Hi {{name}} from {{company}}")).toEqual(["name", "company"]);
  });

  it("renders template variables", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Ari" })).toBe("Hi Ari");
  });
});
