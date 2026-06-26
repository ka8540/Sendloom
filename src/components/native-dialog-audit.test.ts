import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guard: the production source tree must never call a native browser
// dialog (window/globalThis .confirm/.alert/.prompt, or the bare globals). Every
// such interaction now uses an in-app Sendloom component (AppConfirmDialog, the
// toast system, or an in-app input dialog). Test files are excluded, and source
// comments are stripped first so prose mentioning these APIs is not a false
// positive. Method names like onConfirm()/confirmDelete() never match because the
// keyword must be a standalone call (e.g. `confirm(` not preceded by an
// identifier character or a dot).

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

// Drop block + line comments so a comment mentioning these APIs never matches.
// (Line comments are only stripped when "//" is not part of a "://" URL.)
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const SOURCE_FILES = collectSourceFiles("src");

const NATIVE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "window.confirm", regex: /\bwindow\.confirm\s*\(/ },
  { name: "window.alert", regex: /\bwindow\.alert\s*\(/ },
  { name: "window.prompt", regex: /\bwindow\.prompt\s*\(/ },
  { name: "globalThis.confirm", regex: /\bglobalThis\.confirm\s*\(/ },
  { name: "globalThis.alert", regex: /\bglobalThis\.alert\s*\(/ },
  { name: "globalThis.prompt", regex: /\bglobalThis\.prompt\s*\(/ },
  { name: "bare confirm()", regex: /(?<![\w.$])confirm\s*\(/ },
  { name: "bare alert()", regex: /(?<![\w.$])alert\s*\(/ },
  { name: "bare prompt()", regex: /(?<![\w.$])prompt\s*\(/ }
];

describe("Production source contains no native browser dialogs (#1–#6)", () => {
  it("collected a meaningful set of source files to scan", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(50);
  });

  for (const { name, regex } of NATIVE_PATTERNS) {
    it(`has no ${name} call anywhere in production source`, () => {
      const offenders = SOURCE_FILES.filter((file) => regex.test(stripComments(readFileSync(file, "utf8"))));
      expect(offenders).toEqual([]);
    });
  }
});

describe("the audit catches a real offender (guards against a useless test)", () => {
  it("flags an actual native call but not a method/identifier of the same name", () => {
    const confirm = NATIVE_PATTERNS.find((entry) => entry.name === "bare confirm()")!.regex;
    expect(confirm.test('if (confirm("delete?"))')).toBe(true);
    // These are NOT native calls and must not match.
    expect(confirm.test("onConfirm()")).toBe(false);
    expect(confirm.test("void confirmDelete()")).toBe(false);
    expect(confirm.test("dialog.confirm()")).toBe(false);
    expect(/\bwindow\.confirm\s*\(/.test("window.confirm('x')")).toBe(true);
  });
});
