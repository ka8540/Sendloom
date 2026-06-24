// SQL-injection guardrail (static check).
//
// Scans the application source tree for unsafe raw-SQL usage and fails if any is
// found, so the protections added in the SQL-injection hardening work cannot be
// silently regressed later.
//
// What it flags:
//   1. `$queryRawUnsafe` / `$executeRawUnsafe` — prohibited outright. These take
//      a plain SQL string and are the classic injection foot-gun.
//   2. `$queryRaw(` / `$executeRaw(` used as a *function call* (paren opener)
//      instead of a tagged template (backtick). Only the tagged-template form
//      parameterizes interpolated values, so the call form requires review.
//
// Usage:
//   npm run lint:sql                       # scans ./src, exits 1 on findings
//   (the vitest guardrail test imports `findUnsafeRawSql` to assert the same)

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UnsafeSqlFinding = {
  file: string;
  line: number;
  kind: "prohibited-raw-method" | "non-tagged-raw-call";
  detail: string;
};

/** Raw Prisma methods that accept a SQL string and must never appear in source. */
export const PROHIBITED_RAW_METHODS = ["$queryRawUnsafe", "$executeRawUnsafe"] as const;

// Files allowed to mention the prohibited strings as data rather than as live
// calls: this guardrail itself. Test files are excluded separately by extension.
const ALLOWLISTED_FILES = new Set<string>(["scripts/check-unsafe-sql.ts"]);

const SKIP_DIRECTORIES = new Set([".git", ".next", "build", "dist", "node_modules"]);

function isScannableFile(filePath: string): boolean {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) {
    return false;
  }
  // Test files legitimately reference these patterns in assertions/comments.
  if (/\.test\.(ts|tsx|js|jsx)$/.test(filePath)) {
    return false;
  }
  return true;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (isScannableFile(full)) {
      acc.push(full);
    }
  }
  return acc;
}

// `$queryRaw` / `$executeRaw` followed (after an optional generic and whitespace)
// by the opener. A backtick is the safe tagged-template form; `(` is the unsafe
// call form.
const RAW_CALL_PATTERN = /\$(?:queryRaw|executeRaw)(?:<[^>]*>)?\s*([`(])/g;

/** Scan `<rootDir>/src` for unsafe raw-SQL usage. */
export function findUnsafeRawSql(rootDir: string): UnsafeSqlFinding[] {
  const srcDir = path.join(rootDir, "src");
  const findings: UnsafeSqlFinding[] = [];

  for (const file of walk(srcDir)) {
    const relativePath = path.relative(rootDir, file).split(path.sep).join("/");
    if (ALLOWLISTED_FILES.has(relativePath)) {
      continue;
    }

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const method of PROHIBITED_RAW_METHODS) {
        if (line.includes(method)) {
          findings.push({ file: relativePath, line: index + 1, kind: "prohibited-raw-method", detail: method });
        }
      }

      RAW_CALL_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RAW_CALL_PATTERN.exec(line)) !== null) {
        if (match[1] === "(") {
          findings.push({
            file: relativePath,
            line: index + 1,
            kind: "non-tagged-raw-call",
            detail: match[0].trim()
          });
        }
      }
    });
  }

  return findings;
}

const invokedDirectly = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (invokedDirectly) {
  const findings = findUnsafeRawSql(process.cwd());
  if (findings.length > 0) {
    console.error("✗ Unsafe raw SQL detected:\n");
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  [${finding.kind}]  ${finding.detail}`);
    }
    console.error(
      "\nUse Prisma ORM methods or parameterized tagged-template `$queryRaw`/`$executeRaw`.\n" +
        "`$queryRawUnsafe` and `$executeRawUnsafe` are prohibited — user values must be passed\n" +
        "as template placeholders, never concatenated into SQL text."
    );
    process.exit(1);
  }
  console.log("✓ SQL safety check passed: no unsafe raw SQL found in src/.");
}
