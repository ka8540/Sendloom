import sanitizeHtml from "sanitize-html";

import type { MergeVariables } from "@/lib/types";

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

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
