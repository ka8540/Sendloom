import { companyNamesAliasMatch, type NormalizedProfile } from "@/services/prospects/apify-profile-search";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import {
  CONNECTIONS_SEGMENT,
  COUNTRY_ONLY,
  EMPLOYMENT_TYPE_SEGMENT,
  locationLike,
  positionEvidenceDetails,
  resultText,
  snippetPositionEvidenceDetails,
  type PositionEvidence
} from "@/services/prospects/linkedin-search-result-parser";
import { looksLikeRoleTitle } from "@/services/prospects/role-title-evidence";

export type EmploymentDecision = "CURRENT" | "FORMER" | "CONTRADICTORY" | "INSUFFICIENT";
export type CurrentEmploymentEvidence = {
  decision: EmploymentDecision;
  requestedCompanySignals: number;
  contradictorySignals: number;
  historicalSignals: number;
};

const HISTORICAL_MARKER = /\b(?:former(?:ly)?|previously|prior|past|worked\s+at|experience\s+at|before\s+joining|alumni|left|retired|no\s+longer)\b|\bex[-\s]+|\buntil\s+(?:19|20)\d{2}\b/i;
const CURRENT_MARKER = /\b(?:currently|current(?:ly)?\s+(?:works?|employed)|now\s+(?:at|with)|present)\b/i;
const BOILERPLATE = /^(?:view\s+(?:profile|full profile)|experience|education|skills|followers?|\d[\d,]*\+?\s+(?:connections?|followers?))$/i;
const EDUCATION = /\b(?:alumni|university|college|school|academy|bachelor|master(?:'s)?|ph\.?d|degree|computer science)\b/i;
const DATE_OR_DURATION = /\b(?:19|20)\d{2}\b|\b\d+\s*(?:months?|years?)\b/i;

function cleanCompany(value: string): string {
  return resultText(value).replace(/^(?:company|employer|organization)\s*:\s*/i, "").replace(/[.!?]+$/g, "").trim();
}

function plausibleCompany(value: string): boolean {
  const company = cleanCompany(value);
  return Boolean(company) && company.length <= 80 && company.split(/\s+/).length <= 7 && /\p{L}/u.test(company)
    && !BOILERPLATE.test(company) && !EDUCATION.test(company) && !DATE_OR_DURATION.test(company)
    && !CONNECTIONS_SEGMENT.test(company) && !EMPLOYMENT_TYPE_SEGMENT.test(company)
    && !COUNTRY_ONLY.test(company) && !locationLike(company) && !/https?:|www\.|@/i.test(company);
}

function companyMentioned(text: string, companyName: string): boolean {
  const tokens = resultText(text).replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  for (let size = 1; size <= Math.min(6, tokens.length); size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const candidate = tokens.slice(start, start + size).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.&,-]+$/gu, "");
      if (candidate && companyNamesAliasMatch(candidate, companyName)) return true;
    }
  }
  return false;
}

function signalFrom(position: PositionEvidence | null, companyName: string): "TARGET" | "OTHER" | null {
  if (!position || !looksLikeRoleTitle(position.title)) return null;
  const company = cleanCompany(position.company);
  if (!plausibleCompany(company)) return null;
  return companyNamesAliasMatch(company, companyName) ? "TARGET" : "OTHER";
}

/** Fail closed: only current-looking public evidence can admit a public search result. */
export function validateCurrentEmployment(
  result: BrightOrganicResult,
  profile: NormalizedProfile,
  companyName: string
): CurrentEmploymentEvidence {
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, "");
  const headline = resultText(profile.headline ?? "") || /^.+?\s+(?:[-–—]|\|)\s+(.+)$/.exec(title)?.[1]?.trim() || "";
  const options = { expectedCompanyName: companyName };
  const pieces = [{ text: headline, context: headline, position: positionEvidenceDetails(headline, options) },
    ...snippetPositionEvidenceDetails(result.snippet ?? "", options)];
  let requestedCompanySignals = 0;
  let contradictorySignals = 0;
  let historicalSignals = 0;

  for (const piece of pieces) {
    if (HISTORICAL_MARKER.test(piece.context)) {
      if (companyMentioned(piece.text, companyName)) historicalSignals += 1;
      continue;
    }
    const signal = signalFrom(piece.position, companyName);
    if (signal === "TARGET") requestedCompanySignals += 1;
    if (signal === "OTHER" && (piece.text === headline || CURRENT_MARKER.test(piece.context))) contradictorySignals += 1;
  }

  if (historicalSignals > 0 && requestedCompanySignals === 0) {
    return { decision: "FORMER", requestedCompanySignals, contradictorySignals, historicalSignals };
  }
  if (contradictorySignals > 0) {
    return { decision: "CONTRADICTORY", requestedCompanySignals, contradictorySignals, historicalSignals };
  }
  if (requestedCompanySignals > 0) {
    return { decision: "CURRENT", requestedCompanySignals, contradictorySignals, historicalSignals };
  }
  return { decision: "INSUFFICIENT", requestedCompanySignals, contradictorySignals, historicalSignals };
}
