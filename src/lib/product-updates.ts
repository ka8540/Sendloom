import { randomUUID } from "node:crypto";

import { ProductUpdateIcon } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Product Updates (user-facing "What's New") share only validation and error
 * plumbing here. Content is plain text — React renders it escaped, and CTAs
 * are restricted to an allow-list of internal Sendloom destinations.
 */

const ENTITY_ID_PATTERN = "[A-Za-z0-9_-]+";

// Allow-listed in-product CTA destinations (real authenticated routes only).
const SAFE_CTA_HREF_PATTERNS = [
  /^\/workspace$/,
  /^\/finder$/,
  /^\/imports$/,
  /^\/templates$/,
  /^\/suppressions$/,
  /^\/account$/,
  new RegExp(`^/prospects(/${ENTITY_ID_PATTERN})?$`),
  new RegExp(`^/campaigns(/${ENTITY_ID_PATTERN})?$`),
  new RegExp(`^/sequences(/${ENTITY_ID_PATTERN})?$`),
  /^\/analysis(\/(engagement|sequences|reliability|senders))?$/
];

export function isSafeProductUpdateCtaHref(href: string): boolean {
  // Reject external/protocol-relative/Scheme URLs outright before allow-listing.
  if (!href.startsWith("/") || href.startsWith("//")) {
    return false;
  }

  return SAFE_CTA_HREF_PATTERNS.some((pattern) => pattern.test(href));
}

export const productUpdateInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(100, "Keep the title under 100 characters."),
    summary: z.string().trim().min(1, "Summary is required.").max(220, "Keep the summary under 220 characters."),
    description: z
      .string()
      .trim()
      .min(1, "Description is required.")
      .max(5000, "Keep the description under 5000 characters."),
    icon: z.nativeEnum(ProductUpdateIcon, { message: "Choose an icon." }),
    ctaLabel: z.string().trim().max(40, "Keep the CTA label under 40 characters.").nullish(),
    ctaHref: z.string().trim().max(200).nullish()
  })
  .strict()
  .superRefine((value, context) => {
    const label = value.ctaLabel?.trim() || null;
    const href = value.ctaHref?.trim() || null;

    if (href && !isSafeProductUpdateCtaHref(href)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ctaHref"],
        message: "CTA must link to a page inside Sendloom."
      });
    }

    if ((label && !href) || (!label && href)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ctaLabel"],
        message: "A CTA needs both a label and a destination."
      });
    }
  })
  .transform((value) => ({
    ...value,
    ctaLabel: value.ctaLabel?.trim() || null,
    ctaHref: value.ctaHref?.trim() || null
  }));

export type ProductUpdateInput = z.infer<typeof productUpdateInputSchema>;

export const productUpdateSeenSchema = z
  .object({
    ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100)
  })
  .strict();

export function generateProductUpdateSlug(title: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "update";
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export class ProductUpdateValidationError extends Error {}

export class ProductUpdateActionError extends Error {
  constructor(
    message: string,
    public readonly status = 409
  ) {
    super(message);
  }
}

export function productUpdateErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "Invalid product update." }, { status: 400 });
  }
  if (error instanceof ProductUpdateValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ProductUpdateActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[product-updates-api] Request failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return NextResponse.json({ error: "The product update request failed." }, { status: 500 });
}
