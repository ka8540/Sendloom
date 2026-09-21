import { companyNamesAliasMatch, type NormalizedProfile } from "@/services/prospects/apify-profile-search";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import {
  CONNECTIONS_SEGMENT,
  COUNTRY_ONLY,
  EMPLOYMENT_TYPE_SEGMENT,
  locationLike,
  positionEvidenceDetails,
  resultText
} from "@/services/prospects/linkedin-search-result-parser";

export type EmploymentDecision = "CURRENT" | "FORMER" | "CONTRADICTORY" | "INSUFFICIENT";
export type CurrentEmploymentEvidence = {
  decision: EmploymentDecision;
  requestedCompanySignals: number;
  contradictorySignals: number;
  historicalSignals: number;
};

const HISTORICAL_MARKER = /\b(?:former(?:ly)?|previously|prior|past|worked\s+at|experience\s+at|before\s+joining|alumni|left|retired|no\s+longer)\b|\bex[-\s]+|\buntil\s+(?:19|20)\d{2}\b/i;
const CURRENT_MARKER = /\b(?:currently|current(?:ly)?\s+(?:works?|employed)|now\s+(?:at|with)|present)\b/i;
const ROLE_LIKE = /\b(?:engineer(?:ing)?|developer|programmer|architect|recruiter|scientist|analyst|designer|manager|director|lead|specialist|consultant|administrator|executive|officer|president|founder|intern|researcher|sales|marketing|product|operations|security|data|software|frontend|backend|full[ -]?stack|devops|sre|accountant|attorney)\b/i;
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

function signalFrom(text: string, companyName: string): "TARGET" | "OTHER" | null {
  const position = positionEvidenceDetails(text);
  if (!position || !ROLE_LIKE.test(position.title)) return null;
  const company = cleanCompany(position.company);
  if (!plausibleCompany(company)) return null;
  return companyNamesAliasMatch(company, companyName) ? "TARGET" : "OTHER";
}

/** Fail closed: only current-looking public evidence can admit a Bright result. */
export function validateCurrentEmployment(
  result: BrightOrganicResult,
  profile: NormalizedProfile,
  companyName: string
): CurrentEmploymentEvidence {
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, "");
  const headline = resultText(profile.headline ?? "") || /^.+?\s+(?:[-–—]|\|)\s+(.+)$/.exec(title)?.[1]?.trim() || "";
  const pieces = [headline, ...(result.snippet ?? "").split(/\s*[·|;]\s*/)]
    .map((part) => resultText(part)).filter(Boolean);
  let requestedCompanySignals = 0;
  let contradictorySignals = 0;
  let historicalSignals = 0;

  for (const piece of pieces) {
    if (HISTORICAL_MARKER.test(piece)) {
      if (companyMentioned(piece, companyName)) historicalSignals += 1;
      continue;
    }
    const signal = signalFrom(piece, companyName);
    if (signal === "TARGET") requestedCompanySignals += 1;
    if (signal === "OTHER" && (piece === headline || CURRENT_MARKER.test(piece))) contradictorySignals += 1;
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
