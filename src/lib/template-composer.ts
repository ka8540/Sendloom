import type { TemplateFormat } from "@/lib/templates";

export const TEMPLATE_COMPOSER_ATTRIBUTES = [
  { label: "Name", value: "name" },
  { label: "Company", value: "company" },
  { label: "First name", value: "first_name" },
  { label: "Last name", value: "last_name" },
  { label: "Email", value: "email" },
  { label: "Job title", value: "job_title" }
] as const;

export type TemplateComposerCommand = "bold" | "italic" | "strike" | "bullet-list" | "numbered-list" | "link";

export type TemplateComposerEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function replaceSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
  nextSelectionStart = selectionStart + replacement.length,
  nextSelectionEnd = nextSelectionStart
): TemplateComposerEdit {
  return {
    value: `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd
  };
}

function wrapSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix: string,
  fallback: string
) {
  const selectedText = value.slice(selectionStart, selectionEnd) || fallback;
  const replacement = `${prefix}${selectedText}${suffix}`;
  const innerStart = selectionStart + prefix.length;

  return replaceSelection(
    value,
    selectionStart,
    selectionEnd,
    replacement,
    innerStart,
    innerStart + selectedText.length
  );
}

function getSelectedLines(value: string, selectionStart: number, selectionEnd: number) {
  const selectedText = value.slice(selectionStart, selectionEnd);
  return (selectedText || "List item")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)-])\s+/, "").trim())
    .filter(Boolean);
}

function formatList(
  format: TemplateFormat,
  value: string,
  selectionStart: number,
  selectionEnd: number,
  ordered: boolean
) {
  const lines = getSelectedLines(value, selectionStart, selectionEnd);
  const replacement =
    format === "HTML"
      ? `<${ordered ? "ol" : "ul"}>\n${lines.map((line) => `  <li>${line}</li>`).join("\n")}\n</${ordered ? "ol" : "ul"}>`
      : lines.map((line, index) => `${ordered ? `${index + 1}.` : "-"} ${line}`).join("\n");

  return replaceSelection(value, selectionStart, selectionEnd, replacement);
}

export function applyTemplateComposerCommand(
  format: TemplateFormat,
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: TemplateComposerCommand
): TemplateComposerEdit {
  if (format === "JSON") {
    return {
      value,
      selectionStart,
      selectionEnd
    };
  }

  if (command === "bullet-list" || command === "numbered-list") {
    return formatList(format, value, selectionStart, selectionEnd, command === "numbered-list");
  }

  if (command === "link") {
    if (format === "HTML") {
      return wrapSelection(value, selectionStart, selectionEnd, '<a href="https://example.com">', "</a>", "link text");
    }

    const selectedText = value.slice(selectionStart, selectionEnd);
    const replacement = selectedText ? `${selectedText} (https://example.com)` : "https://example.com";
    const urlStart = selectionStart + replacement.indexOf("https://");

    return replaceSelection(value, selectionStart, selectionEnd, replacement, urlStart, urlStart + "https://example.com".length);
  }

  const wrappers =
    format === "HTML"
      ? {
          bold: ["<strong>", "</strong>", "bold text"],
          italic: ["<em>", "</em>", "italic text"],
          strike: ["<s>", "</s>", "strikethrough text"]
        }
      : {
          bold: ["**", "**", "bold text"],
          italic: ["*", "*", "italic text"],
          strike: ["~~", "~~", "strikethrough text"]
        };
  const [prefix, suffix, fallback] = wrappers[command];

  return wrapSelection(value, selectionStart, selectionEnd, prefix, suffix, fallback);
}

export function insertTemplateAttribute(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  attribute: string
): TemplateComposerEdit {
  const replacement = `{{${attribute}}}`;
  return replaceSelection(value, selectionStart, selectionEnd, replacement);
}
