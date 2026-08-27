import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Client components are verified via source assertions (node env, no DOM) —
// the same style used across the codebase for client components.
const VIEW_SOURCE = readFileSync("src/components/product-updates/whats-new-view.tsx", "utf8");
const CARD_SOURCE = readFileSync("src/components/product-updates/product-update-card.tsx", "utf8");
const PAGE_SOURCE = readFileSync("src/app/(app)/whats-new/page.tsx", "utf8");
const ADMIN_WORKSPACE_SOURCE = readFileSync(
  "src/app/(app)/admin/product-updates/product-updates-workspace.tsx",
  "utf8"
);

describe("What's New page header and structure", () => {
  it("renders the specified header copy", () => {
    expect(VIEW_SOURCE).toContain("What&apos;s New");
    expect(VIEW_SOURCE).toContain("<h1>New in Sendloom</h1>");
    expect(VIEW_SOURCE).toContain("Discover the latest features and improvements.");
  });

  it("shows the specified empty state", () => {
    expect(VIEW_SOURCE).toContain("Nothing new right now");
    expect(VIEW_SOURCE).toContain("New Sendloom features and improvements will appear here.");
  });

  it("loads the first page server-side with the bounded default page size", () => {
    expect(PAGE_SOURCE).toContain("listPublishedProductUpdates(user.id");
    expect(PAGE_SOURCE).toContain("PRODUCT_UPDATE_USER_PAGE_SIZE");
  });
});

describe("feature cards", () => {
  it("renders a text NEW badge, semantic card headings, and all content fields", () => {
    expect(CARD_SOURCE).toContain(">NEW</span>");
    expect(CARD_SOURCE).toContain("<h2 className={styles.title}>");
    expect(CARD_SOURCE).toContain("{update.summary}");
    expect(CARD_SOURCE).toContain("{update.description}");
    expect(VIEW_SOURCE).toContain("isNew={!seenIds.has(item.id)}");
  });

  it("renders the CTA as a real Next link", () => {
    expect(CARD_SOURCE).toContain('from "next/link"');
    expect(CARD_SOURCE).toContain("<Link href={update.ctaHref as Route}");
  });

  it("orders cards newest published first via the server query", () => {
    // The user page passes service output straight through; the service orders
    // by publishedAt desc (covered in services/product-updates.test.ts).
    expect(PAGE_SOURCE).toContain("initialItems={page.items}");
  });
});

describe("seen-on-view behavior", () => {
  it("marks loaded update ids seen through the bulk endpoint", () => {
    expect(VIEW_SOURCE).toContain('fetch("/api/product-updates/seen"');
    expect(VIEW_SOURCE).toContain('method: "POST"');
    expect(VIEW_SOURCE).toContain("body: JSON.stringify({ ids })");
  });

  it("clears NEW markers locally and refreshes the sidebar badge without a reload", () => {
    expect(VIEW_SOURCE).toContain("setSeenIds((current) => new Set([...current, ...ids]))");
    expect(VIEW_SOURCE).toContain('PRODUCT_UPDATES_SEEN_EVENT = "sendloom:product-updates-seen"');
    expect(VIEW_SOURCE).toContain("window.dispatchEvent(");
    expect(VIEW_SOURCE).toContain("unseenCount: body?.unseenCount ?? 0");
  });

  it("pages older updates with the cursor instead of loading everything", () => {
    expect(VIEW_SOURCE).toContain("?cursor=${encodeURIComponent(nextCursor)}");
    expect(VIEW_SOURCE).toContain("Load earlier updates");
  });
});

describe("admin workspace", () => {
  it("uses the specified header and metric cards", () => {
    expect(ADMIN_WORKSPACE_SOURCE).toContain("Product communications");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("<h1>Product Updates</h1>");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("Publish new features and improvements for Sendloom users.");
    for (const label of ['"Drafts"', '"Published"', '"Archived"', '"Total views"']) {
      expect(ADMIN_WORKSPACE_SOURCE).toContain(`label: ${label}`);
    }
  });

  it("lists updates with the specified columns and lifecycle actions", () => {
    for (const column of ["<th>Update</th>", "<th>Status</th>", "<th>Published</th>", "<th>Views</th>", "<th>Created by</th>", "<th>Actions</th>"]) {
      expect(ADMIN_WORKSPACE_SOURCE).toContain(column);
    }
    expect(ADMIN_WORKSPACE_SOURCE).toContain("> Edit");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("> Preview");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("> Publish");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("Archive");
  });

  it("previews the exact user card without publishing or counting views", () => {
    // The composer and preview modal render the shared ProductUpdateCard only;
    // no publish or seen endpoint is called for previews.
    expect(ADMIN_WORKSPACE_SOURCE).toContain("<ProductUpdateCard update={composerPreview} />");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("<ProductUpdateCard update={previewTarget} />");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("Previewing never publishes and never counts views.");
  });

  it("shows the specified admin empty state", () => {
    expect(ADMIN_WORKSPACE_SOURCE).toContain("No product updates yet");
    expect(ADMIN_WORKSPACE_SOURCE).toContain("Publish feature announcements so users can discover what&apos;s new.");
  });
});

describe("plain-text safety", () => {
  it("never injects admin-authored HTML", () => {
    const sources = readdirSync("src/components/product-updates")
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFileSync(`src/components/product-updates/${file}`, "utf8"));
    sources.push(ADMIN_WORKSPACE_SOURCE);

    for (const source of sources) {
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("sends no email and creates no bell notifications", () => {
    expect(ADMIN_WORKSPACE_SOURCE).not.toMatch(/resend|sendEmail|AppNotification/);
    expect(VIEW_SOURCE).not.toMatch(/resend|sendEmail|AppNotification/);
    expect(CARD_SOURCE).not.toMatch(/resend|sendEmail|AppNotification/);
  });
});
