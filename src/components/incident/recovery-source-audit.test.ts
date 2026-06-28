import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the recovery UI conventions (this repo runs in a node test
// environment with no DOM renderer, so component behavior is verified through the
// pure logic in app-error/normalize-client-error and these source assertions).
const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("incident recovery UI conventions", () => {
  it("the report dialog uses the shared circular close button", () => {
    expect(read("src/components/incident/report-issue-dialog.tsx")).toContain("CircularCloseButton");
  });

  it("the admin incident detail modal uses the shared circular close button", () => {
    expect(read("src/app/(app)/admin/incidents/incidents-workspace.tsx")).toContain("CircularCloseButton");
  });

  it("recovery components never call a native browser dialog", () => {
    for (const file of ["error-recovery-panel.tsx", "report-issue-dialog.tsx"]) {
      const source = read(`src/components/incident/${file}`);
      expect(source).not.toMatch(/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/);
      expect(source).not.toMatch(/(?<![\w.$])(?:confirm|alert|prompt)\s*\(/);
    }
  });

  it("Reconnect Gmail targets the Google connect route", () => {
    expect(read("src/components/incident/client-diagnostics.ts")).toContain("/api/auth/google/connect");
  });

  it("the report dialog attaches the CSRF header directly (works inside global-error)", () => {
    expect(read("src/components/incident/report-issue-dialog.tsx")).toContain("x-csrf-token");
  });
});
