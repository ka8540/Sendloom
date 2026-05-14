import sanitizeHtml from "sanitize-html";

import type { MergeVariables } from "@/lib/types";

export const TEMPLATE_FORMATS = ["PLAIN_TEXT", "HTML", "JSON"] as const;

export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const UNORDERED_LIST_ITEM_PATTERN = /^(?:[-*]|\u2022)\s+(.+)$/;
const ORDERED_LIST_ITEM_PATTERN = /^\d+(?:[.)]|-)\s+(.+)$/;
const TEMPLATE_PREVIEW_SAMPLE_VALUES: Record<string, string> = {
  company: "Acme",
  email: "alex@example.com",
  first_name: "Alex",
  firstname: "Alex",
  firstName: "Alex",
  job_title: "Software Engineer",
  jobtitle: "Software Engineer",
  jobTitle: "Software Engineer",
  last_name: "Morgan",
  lastname: "Morgan",
  lastName: "Morgan",
  name: "Alex",
  role: "Software Engineer",
  title: "Software Engineer"
};
const DEFAULT_JSON_TEMPLATE = {
  greeting: "Hi {{name}},",
  intro: "I noticed {{company}} and wanted to reach out.",
  body: "I help teams tighten their outreach workflow without losing a personal tone.",
  cta: "Would it make sense to connect for a quick chat?",
  signoff: "Best,\n{{name}}"
};

type PlainTextBlock =
  | {
      type: "paragraph";
      lines: string[];
    }
  | {
      type: "ul" | "ol";
      items: string[];
    };

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeVariableName(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function titleCaseVariable(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getTemplatePreviewFallback(variable: string) {
  return (
    TEMPLATE_PREVIEW_SAMPLE_VALUES[variable] ??
    TEMPLATE_PREVIEW_SAMPLE_VALUES[normalizeVariableName(variable)] ??
    titleCaseVariable(variable) ??
    variable
  );
}

function hasPreviewValue(value: MergeVariables[string] | undefined) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function stripHtml(input: string) {
  return input
    .replace(/<a\b[^>]*>/gi, " ")
    .replace(/<\/a>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

function splitParagraphs(input: string) {
  return input
    .trim()
    .split(/\n\s*\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeLineEndings(input: string) {
  return input.replace(/\r\n?/g, "\n");
}

function parseJsonTemplate(input: string) {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function renderPlainTextParagraph(paragraph: string) {
  return `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`;
}

function renderPlainTextLines(lines: string[]) {
  return escapeHtml(lines.join("\n")).replace(/\n/g, "<br />");
}

function parseListItem(line: string) {
  const unorderedMatch = line.match(UNORDERED_LIST_ITEM_PATTERN);
  if (unorderedMatch) {
    return {
      type: "ul" as const,
      content: unorderedMatch[1].trim()
    };
  }

  const orderedMatch = line.match(ORDERED_LIST_ITEM_PATTERN);
  if (orderedMatch) {
    return {
      type: "ol" as const,
      content: orderedMatch[1].trim()
    };
  }

  return null;
}

function parsePlainTextBlocks(input: string): PlainTextBlock[] {
  const blocks: PlainTextBlock[] = [];
  const lines = normalizeLineEndings(input).split("\n");
  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  function flushParagraph() {
    const nextLines = paragraphLines.map((line) => line.trimEnd()).filter((line) => line.trim());
    if (nextLines.length) {
      blocks.push({
        type: "paragraph",
        lines: nextLines
      });
    }
    paragraphLines = [];
  }

  function flushList() {
    const nextItems = listItems.map((item) => item.trim()).filter(Boolean);
    if (listType && nextItems.length) {
      blocks.push({
        type: listType,
        items: nextItems
      });
    }
    listType = null;
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const listItem = parseListItem(trimmed);
    if (listItem) {
      flushParagraph();

      if (listType && listType !== listItem.type) {
        flushList();
      }

      listType = listItem.type;
      listItems.push(listItem.content);
      continue;
    }

    if (listType && listItems.length && /^\s+/.test(rawLine)) {
      const nextItem = `${listItems[listItems.length - 1]}\n${trimmed}`;
      listItems[listItems.length - 1] = nextItem;
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderPlainTextContent(input: string) {
  return parsePlainTextBlocks(input)
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p>${renderPlainTextLines(block.lines)}</p>`;
      }

      const items = block.items.map((item) => `<li>${renderPlainTextLines(item.split("\n"))}</li>`).join("");
      return items ? `<${block.type}>${items}</${block.type}>` : "";
    })
    .filter(Boolean)
    .join("");
}

function collectJsonText(input: unknown, output: string[] = []) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      output.push(trimmed);
    }
    return output;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    output.push(String(input));
    return output;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectJsonText(item, output));
    return output;
  }

  if (input && typeof input === "object") {
    Object.values(input).forEach((value) => collectJsonText(value, output));
  }

  return output;
}

function renderJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return renderPlainTextParagraph(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return renderPlainTextParagraph(String(value));
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return `<li>${escapeHtml(String(item))}</li>`;
        }

        const nested = renderJsonValue(item);
        return nested ? `<li>${nested}</li>` : "";
      })
      .filter(Boolean)
      .join("");

    return items ? `<ul>${items}</ul>` : "";
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .map((nestedValue) => renderJsonValue(nestedValue))
      .filter(Boolean)
      .join("");
  }

  return "";
}

function applyMergeVariablesToJson(value: unknown, payload: MergeVariables): unknown {
  if (typeof value === "string") {
    return renderTemplate(value, payload);
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyMergeVariablesToJson(item, payload));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, applyMergeVariablesToJson(nestedValue, payload)])
    );
  }

  return value;
}

function buildJsonTemplateFromText(input: string) {
  const paragraphs = splitParagraphs(input);

  if (!paragraphs.length) {
    return DEFAULT_JSON_TEMPLATE;
  }

  if (paragraphs.length === 1) {
    return {
      message: paragraphs[0]
    };
  }

  if (paragraphs.length === 2) {
    return {
      intro: paragraphs[0],
      body: paragraphs[1]
    };
  }

  return {
    greeting: paragraphs[0],
    body: paragraphs.slice(1, -1).join("\n\n"),
    cta: paragraphs[paragraphs.length - 1]
  };
}

export function getTemplateFormatLabel(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return "Plain text";
  }

  if (format === "JSON") {
    return "Structured JSON";
  }

  return "HTML";
}

export function getDefaultTemplateBody(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return "Hi {{name}},\n\nI noticed {{company}} and wanted to reach out.";
  }

  if (format === "JSON") {
    return JSON.stringify(DEFAULT_JSON_TEMPLATE, null, 2);
  }

  return `<p>Hi {{name}},</p>\n<p>I noticed {{company}} and wanted to reach out.</p>`;
}

export function getTemplateBodyLabel(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return "Email body";
  }

  if (format === "JSON") {
    return "Structured email JSON";
  }

  return "HTML body";
}

export function getTemplateBodyHint(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return "Write it like a real email. Paragraph breaks, bullets, numbered lists, and merge fields will carry through to the preview.";
  }

  if (format === "JSON") {
    return "Use JSON to describe the message sections. Sendloom will render it into the email preview and delivery output.";
  }

  return "Use valid HTML fragments only. Paragraphs, lists, links, and merge fields all render in the preview.";
}

export function getTemplateBodyPlaceholder(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return "Hi {{name}},\n\nI noticed {{company}} and wanted to reach out.";
  }

  if (format === "JSON") {
    return JSON.stringify(DEFAULT_JSON_TEMPLATE, null, 2);
  }

  return "<p>Hi {{name}},</p>\n<p>I noticed {{company}} and wanted to reach out.</p>";
}

export function extractTemplateVariables(input: string) {
  const matches = new Set<string>();
  for (const match of input.matchAll(VARIABLE_PATTERN)) {
    matches.add(match[1]);
  }
  return Array.from(matches);
}

export function buildTemplatePreviewPayload(variables: string[], payload: MergeVariables = {}) {
  const previewPayload: MergeVariables = { ...payload };

  for (const variable of variables) {
    if (!hasPreviewValue(previewPayload[variable])) {
      previewPayload[variable] = getTemplatePreviewFallback(variable);
    }
  }

  return previewPayload;
}

export function renderTemplate(input: string, payload: MergeVariables) {
  return input.replace(VARIABLE_PATTERN, (_, key) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderTemplateSubjectPreview(input: string, payload: MergeVariables = {}) {
  const previewPayload = buildTemplatePreviewPayload(extractTemplateVariables(input), payload);
  return renderTemplate(input, previewPayload);
}

export function templateContentToPlainText(format: TemplateFormat, input: string) {
  if (!input.trim()) {
    return "";
  }

  if (format === "HTML") {
    return stripHtml(input);
  }

  if (format === "JSON") {
    const parsed = parseJsonTemplate(input);
    if (!parsed) {
      return input.trim();
    }

    return collectJsonText(parsed).join("\n\n").trim();
  }

  return input.trim();
}

export function convertTemplateBody(input: string, fromFormat: TemplateFormat, toFormat: TemplateFormat) {
  if (fromFormat === toFormat) {
    return input;
  }

  const plainText = templateContentToPlainText(fromFormat, input);
  if (!plainText) {
    return getDefaultTemplateBody(toFormat);
  }

  if (toFormat === "PLAIN_TEXT") {
    return plainText;
  }

  if (toFormat === "JSON") {
    return JSON.stringify(buildJsonTemplateFromText(plainText), null, 2);
  }

  return renderPlainTextContent(plainText);
}

export function validateTemplateBody(format: TemplateFormat, input: string) {
  if (!input.trim()) {
    return "Add body content before saving.";
  }

  if (format === "JSON" && !parseJsonTemplate(input)) {
    return "JSON format needs valid JSON before it can be saved or sent.";
  }

  return null;
}

export function renderTemplateContent(format: TemplateFormat, input: string, payload: MergeVariables = {}) {
  if (!input.trim()) {
    return "<p>Add body content to preview it here.</p>";
  }

  if (format === "PLAIN_TEXT") {
    const renderedText = renderTemplate(input, payload);
    return renderPlainTextContent(renderedText);
  }

  if (format === "JSON") {
    const parsed = parseJsonTemplate(input);
    if (!parsed) {
      return `<p>${escapeHtml(input)}</p>`;
    }

    const mergedJson = applyMergeVariablesToJson(parsed, payload);
    const rendered = renderJsonValue(mergedJson);
    return rendered || "<p>Add body content to preview it here.</p>";
  }

  return renderTemplate(input, payload);
}

export function sanitizeTemplatePreview(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"]
    }
  });
}

export function renderTemplatePreview(format: TemplateFormat, input: string, payload: MergeVariables = {}) {
  const previewPayload = buildTemplatePreviewPayload(extractTemplateVariables(input), payload);
  return sanitizeTemplatePreview(renderTemplateContent(format, input, previewPayload));
}
