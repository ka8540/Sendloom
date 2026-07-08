import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The preview modal is a "use client" component and the suite runs in a node
// env (no DOM), so the blob-preview behavior is verified through source
// assertions — the same style used by the rest of the component suite.
const PREVIEW_SOURCE = readFileSync("src/components/attachment-preview.tsx", "utf8");
const PREVIEW_CSS = readFileSync("src/components/attachment-preview.module.css", "utf8");
const ROUTE_SOURCE = readFileSync(
  "src/app/api/campaigns/[id]/attachments/[attachmentIndex]/route.ts",
  "utf8"
);
const NEXT_CONFIG = readFileSync("next.config.mjs", "utf8");

// ---------------------------------------------------------------------------
// PDF/text preview is framed from a locally-fetched blob, not the app route
// ---------------------------------------------------------------------------

describe("AttachmentPreviewModal renders PDFs via an authenticated blob fetch", () => {
  it("fetches the preview URL over the same-origin session and reads it as a blob", () => {
    expect(PREVIEW_SOURCE).toMatch(/fetch\(previewUrl,\s*\{\s*credentials: "same-origin"/);
    expect(PREVIEW_SOURCE).toContain("response.blob()");
    // A non-OK response is treated as a preview failure (no broken frame).
    expect(PREVIEW_SOURCE).toMatch(/if \(!response\.ok\)/);
  });

  it("frames a local object URL instead of iframing the authenticated route", () => {
    expect(PREVIEW_SOURCE).toContain("URL.createObjectURL(blob)");
    expect(PREVIEW_SOURCE).toContain("<iframe key={frameUrl} src={frameUrl}");
    // The route URL must never be iframed directly (that is what "refused to
    // connect" came from).
    expect(PREVIEW_SOURCE).not.toContain("src={attachment.previewUrl} title");
  });

  it("revokes the object URL it created on close/unmount, but never the editor's blob", () => {
    expect(PREVIEW_SOURCE).toContain("URL.revokeObjectURL(createdUrl)");
    // Freshly-uploaded blobs are owned by the editor: framed directly, not revoked.
    expect(PREVIEW_SOURCE).toMatch(/previewUrl\.startsWith\("blob:"\)/);
    expect(PREVIEW_SOURCE).toMatch(/blob:[\s\S]{0,220}setFrameUrl\(previewUrl\)/);
  });

  it("shows a loading state while fetching and a safe fallback on failure", () => {
    expect(PREVIEW_SOURCE).toContain("Loading preview…");
    expect(PREVIEW_SOURCE).toContain("Preview unavailable.");
    expect(PREVIEW_SOURCE).toContain("Open or download the file instead.");
    // No raw hostname/URL is surfaced in the error state.
    expect(PREVIEW_SOURCE).not.toMatch(/refused to connect|sendloom\.net/i);
    expect(PREVIEW_CSS).toContain("attachmentPreviewSpin");
  });

  it("keeps Open on the authenticated route and Download on the download route", () => {
    expect(PREVIEW_SOURCE).toContain('href={attachment.previewUrl} target="_blank"');
    expect(PREVIEW_SOURCE).toContain("href={attachment.downloadUrl}");
  });
});

// ---------------------------------------------------------------------------
// The framing headers still lock the app down; only same-origin blobs frame
// ---------------------------------------------------------------------------

describe("Security headers still block external framing", () => {
  it("permits same-origin blob framing without opening the app to embedding", () => {
    expect(NEXT_CONFIG).toContain("frame-src 'self' blob:");
    expect(NEXT_CONFIG).toContain("frame-ancestors 'none'");
    // We did not weaken these while enabling the preview.
    expect(NEXT_CONFIG).toContain("object-src 'none'");
    expect(NEXT_CONFIG).toContain('value: "DENY"');
  });
});

// ---------------------------------------------------------------------------
// The attachment route's auth/ownership + disposition behavior is unchanged
// ---------------------------------------------------------------------------

describe("Attachment route still enforces ownership and safe disposition", () => {
  it("requires an authenticated user and scopes the campaign to that user", () => {
    expect(ROUTE_SOURCE).toContain("requireApiUser()");
    expect(ROUTE_SOURCE).toMatch(/userId: auth\.user\.id/);
  });

  it("serves inline previews but forces download on ?download=1 and unsafe types", () => {
    expect(ROUTE_SOURCE).toMatch(/searchParams\.get\("download"\) === "1"/);
    expect(ROUTE_SOURCE).toContain("buildContentDisposition(attachment.fileName, forceDownload)");
    expect(ROUTE_SOURCE).toContain('"Cache-Control": "private, no-store"');
    expect(ROUTE_SOURCE).toContain('"X-Content-Type-Options": "nosniff"');
  });
});
