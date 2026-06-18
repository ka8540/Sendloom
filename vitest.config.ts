import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(new URL(import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(rootDir, "src")
    },
    // Ensure a single `graphql` instance — graphql-yoga (used to build the
    // schema) and the test's direct `graphql()`/`validate()` imports must share
    // one copy, otherwise schema objects are rejected as cross-realm.
    dedupe: ["graphql"]
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // graphql ships both CJS and ESM entry points. Inlining it (and its
    // consumers) forces a single transformed instance so a schema built by
    // graphql-yoga is accepted by the test's own graphql()/validate() calls.
    server: {
      deps: {
        inline: ["graphql", "graphql-yoga", /@graphql-tools/]
      }
    }
  }
});
