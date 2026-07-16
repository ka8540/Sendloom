import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type ModalContract = {
  file: string;
  overlay: string;
  card: string;
};

const MODALS: ModalContract[] = [
  { file: "src/components/app-confirm-dialog.module.css", overlay: ".backdrop", card: ".card" },
  { file: "src/components/attachment-preview.module.css", overlay: ".backdrop", card: ".modal" },
  { file: "src/components/import-editor-dialog.module.css", overlay: ".backdrop", card: ".card" },
  { file: "src/components/past-schedule-relaunch-modal.module.css", overlay: ".modalBackdrop", card: ".modalCard" },
  { file: "src/components/sequence-limit-dialog.module.css", overlay: ".backdrop", card: ".card" },
  { file: "src/components/campaign-schedule-editor.module.css", overlay: ".modalBackdrop", card: ".modalCard" },
  { file: "src/components/incident/report-issue-dialog.module.css", overlay: ".backdrop", card: ".card" },
  { file: "src/components/incident/help-report-dialog.module.css", overlay: ".backdrop", card: ".card" },
  { file: "src/components/hunter-dashboard.module.css", overlay: ".modalBackdrop", card: ".modalCard" },
  { file: "src/components/prospects/prospects-dashboard.module.css", overlay: ".modalOverlay", card: ".modalCard" },
  { file: "src/app/(app)/admin/incidents/incidents.module.css", overlay: ".modalBackdrop", card: ".modalCard" }
];

function rule(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
}

describe("app modal positioning contract", () => {
  it.each(MODALS)("centers $file inside a full-viewport overlay", ({ file, overlay }) => {
    const source = readFileSync(file, "utf8");
    const overlayRule = rule(source, overlay);

    expect(overlayRule).toContain("position: fixed;");
    expect(overlayRule).toContain("inset: 0;");
    expect(overlayRule).toContain("display: grid;");
    expect(overlayRule).toContain("place-items: center;");
    expect(overlayRule).not.toContain("place-items: start");
  });

  it.each(MODALS)("keeps $file within the viewport with safe scrolling", ({ file, card }) => {
    const source = readFileSync(file, "utf8");
    const cardRule = rule(source, card);

    expect(cardRule).toMatch(/max-height:\s*calc\(100(?:d)?vh\s*-\s*[23]rem\);/);
    expect(cardRule).toMatch(/overflow(?:-y)?:\s*(?:auto|hidden);/);
  });
});
