import { readFileSync } from "node:fs";

import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import FinderPage from "@/app/(app)/finder/page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("legacy Finder route", () => {
  it("redirects directly to Discover on the server", () => {
    FinderPage();

    expect(redirect).toHaveBeenCalledWith("/prospects");
    const source = readFileSync("src/app/(app)/finder/page.tsx", "utf8");
    expect(source).not.toContain("HunterDashboard");
  });
});
