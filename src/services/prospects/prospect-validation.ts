import { z } from "zod";

import {
  isLinkedInCompanyUrl,
  isPersonalEmailDomain,
  normalizeDomain
} from "@/services/prospects/prospect-normalization";

export const MAX_JOB_TITLES = 10;
export const MAX_LOCATIONS = 10;
export const MAX_RESULTS_HARD_LIMIT = 200;

export type ValidatedCreateProspectSearch = {
  companyName: string;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  jobTitles: string[];
  locations: string[];
  maxResults: number;
};

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

/**
 * Validate + normalize the createProspectSearch input. Everything is trimmed,
 * arrays are de-duplicated, empty arrays are rejected, malformed LinkedIn URLs
 * and personal email domains are rejected.
 */
export const createProspectSearchSchema = z
  .object({
    companyName: z.string(),
    companyDomain: z.string().nullish(),
    companyLinkedinUrl: z.string().nullish(),
    jobTitles: z.array(z.string()),
    locations: z.array(z.string()).nullish(),
    maxResults: z.number().int().nullish()
  })
  .transform((value, ctx): ValidatedCreateProspectSearch => {
    let failed = false;
    const fail = (path: (string | number)[], message: string) => {
      failed = true;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };

    const companyName = value.companyName.trim();
    if (!companyName) {
      fail(["companyName"], "companyName is required.");
    }
    if (companyName.length > 200) {
      fail(["companyName"], "companyName must be at most 200 characters.");
    }

    const jobTitles = uniqueTrimmed(value.jobTitles ?? []);
    if (jobTitles.length === 0) {
      fail(["jobTitles"], "At least one job title is required.");
    }
    if (jobTitles.length > MAX_JOB_TITLES) {
      fail(["jobTitles"], `At most ${MAX_JOB_TITLES} job titles are allowed.`);
    }

    const locations = uniqueTrimmed(value.locations ?? []);
    if (locations.length > MAX_LOCATIONS) {
      fail(["locations"], `At most ${MAX_LOCATIONS} locations are allowed.`);
    }

    let companyDomain: string | null = null;
    const rawDomain = value.companyDomain?.trim();
    if (rawDomain) {
      const normalized = normalizeDomain(rawDomain);
      if (!normalized) {
        fail(["companyDomain"], "Enter a valid company domain like stripe.com.");
      } else if (isPersonalEmailDomain(normalized)) {
        fail(["companyDomain"], "A personal email domain cannot be used as a company domain.");
      } else {
        companyDomain = normalized;
      }
    }

    let companyLinkedinUrl: string | null = null;
    const rawLinkedin = value.companyLinkedinUrl?.trim();
    if (rawLinkedin) {
      if (!isLinkedInCompanyUrl(rawLinkedin)) {
        fail(["companyLinkedinUrl"], "Enter a valid LinkedIn company URL.");
      } else {
        companyLinkedinUrl = rawLinkedin;
      }
    }

    const maxResults = value.maxResults ?? 25;
    if (maxResults < 1) {
      fail(["maxResults"], "maxResults must be at least 1.");
    }
    if (maxResults > MAX_RESULTS_HARD_LIMIT) {
      fail(["maxResults"], `maxResults must be at most ${MAX_RESULTS_HARD_LIMIT}.`);
    }

    if (failed) {
      return z.NEVER;
    }

    return {
      companyName,
      companyDomain,
      companyLinkedinUrl,
      jobTitles,
      locations,
      maxResults
    };
  });

export type CreateProspectSearchInput = z.input<typeof createProspectSearchSchema>;
