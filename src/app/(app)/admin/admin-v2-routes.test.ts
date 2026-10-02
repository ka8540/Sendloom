import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) =>
  readFileSync(`src/app/(app)/admin/${path}/page.tsx`, "utf8");
describe("Admin legacy route compatibility", () => {
  it.each([
    ["system-health", "/admin/operations"],
    ["incidents", "/admin/operations/incidents"],
    ["system-notices", "/admin/communications/system-notices"],
    ["product-updates", "/admin/communications/product-updates"],
  ])("redirects %s into %s after an admin check", (route, target) => {
    const source = read(route);
    expect(source).toContain("requireAdminUser()");
    expect(source).toContain(`redirect("${target}")`);
  });
  it("routes restriction and activity links with a user ID to the corresponding detail tab", () => {
    expect(read("restrictions")).toContain("?tab=access");
    expect(read("activity")).toContain("?tab=activity");
  });
});
