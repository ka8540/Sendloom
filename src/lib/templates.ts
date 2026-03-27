import sanitizeHtml from "sanitize-html";

import type { MergeVariables } from "@/lib/types";

export const TEMPLATE_FORMATS = ["PLAIN_TEXT", "HTML", "JSON"] as const;

export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const DEFAULT_JSON_TEMPLATE = {
  greeting: "Hi {{name}},",
  intro: "I noticed {{company}} and wanted to reach out.",
  body: "I help teams tighten their outreach workflow without losing a personal tone.",
  cta: "Would it make sense to connect for a quick chat?",
  signoff: "Best,\n{{name}}"
};

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    return "Write it like a real email. Paragraph breaks and merge fields will carry through to the preview.";
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

export function renderTemplate(input: string, payload: MergeVariables) {
  return input.replace(VARIABLE_PATTERN, (_, key) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
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

  return splitParagraphs(plainText)
    .map((paragraph) => renderPlainTextParagraph(paragraph))
    .join("\n");
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
    return splitParagraphs(renderedText).map((paragraph) => renderPlainTextParagraph(paragraph)).join("");
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
  return sanitizeTemplatePreview(renderTemplateContent(format, input, payload));
}
