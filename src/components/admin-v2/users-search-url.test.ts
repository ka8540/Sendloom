import { describe, expect, it } from "vitest";
import { adminUsersSearchHref } from "./users-search-url";

describe("Admin Users search URL", () => {
  it("preserves the status filter and resets the server page", () => {
    expect(
      adminUsersSearchHref(
        "?status=attention&page=4&q=old",
        "  new@example.com  ",
      ),
    ).toBe("/admin/users?status=attention&q=new%40example.com");
  });

  it("clears search without clearing the status filter", () => {
    expect(adminUsersSearchHref("?status=restricted&page=2&q=old", " ")).toBe(
      "/admin/users?status=restricted",
    );
  });
});
