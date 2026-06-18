// Pure normalization helpers for the prospect graph. No network, no AI — these
// are deterministic and exhaustively unit-tested.

// Common consumer / free mailbox domains that must never be treated as a
// company's official domain (used both for input validation and as a guard
// before generating any inferred business email).
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "pm.me",
  "fastmail.com"
]);

// Corporate suffixes stripped when building a normalized company key.
const COMPANY_SUFFIX_PATTERN =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|llp|lp|sa|ag|pty|group|holdings|technologies|technology|labs|software|solutions)\b/gi;

// Professional / generational name suffixes removed before generating emails.
const NAME_SUFFIX_PATTERN = /\b(jr|sr|ii|iii|iv|v|phd|ph\.d|md|mba|cpa|esq|do|rn|dds)\b/gi;

export function stripDiacritics(value: string): string {
  // NFKD splits accented characters into base + combining marks; we then drop
  // the combining marks. Also fold common ligatures and the German ß.
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00df/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ø/gi, "o")
    .replace(/đ/gi, "d")
    .replace(/ł/gi, "l");
}

export function normalizeCompanyName(name: string): string {
  const base = stripDiacritics(name)
    .toLowerCase()
    .replace(/[&]/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(COMPANY_SUFFIX_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  return base || stripDiacritics(name).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const stripped = stripDiacritics(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.split("#")[0]
    ?.split("@")
    .pop();

  if (!stripped || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(stripped)) {
    return null;
  }

  return stripped;
}

export function isPersonalEmailDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return false;
  }
  return PERSONAL_EMAIL_DOMAINS.has(normalized);
}

export function isValidCompanyDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeDomain(domain);
  return Boolean(normalized) && !isPersonalEmailDomain(normalized);
}

const LINKEDIN_PROFILE_PATTERN = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|pub)\//i;
const LINKEDIN_COMPANY_PATTERN = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\//i;

export function isLinkedInProfileUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && LINKEDIN_PROFILE_PATTERN.test(url.trim());
}

export function isLinkedInCompanyUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && LINKEDIN_COMPANY_PATTERN.test(url.trim());
}

// Reduce a raw job title to a stable lookup key: lowercase, de-accented,
// punctuation collapsed to single spaces. Used for deterministic mapping and
// the classification cache so "Sr. Software Engineer " and "senior software
// engineer" collapse predictably for caching while preserving meaning.
export function normalizeTitle(title: string): string {
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/[^a-z0-9+/&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameTokens = {
  /** Lowercase ascii first name suitable for an email local part, or null. */
  first: string | null;
  /** Lowercase ascii last name suitable for an email local part, or null. */
  last: string | null;
};

// Convert a raw name into ascii tokens usable in an email local part. Strips
// suffixes, diacritics, apostrophes, and joins hyphenated parts. Returns null
// tokens when a usable component is missing.
export function normalizeNameForEmail(firstName: string, lastName: string): NameTokens {
  const clean = (value: string) =>
    stripDiacritics(value)
      .toLowerCase()
      .replace(NAME_SUFFIX_PATTERN, " ")
      .replace(/['’]/g, "") // O'Brien -> obrien
      .replace(/[-\s]+/g, "") // Smith-Jones / "de la cruz" -> collapse
      .replace(/[^a-z]/g, "")
      .trim();

  const first = clean(firstName) || null;
  const last = clean(lastName) || null;

  return { first, last };
}

export type ParsedLocation = {
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

// Best-effort split of a free-form "City, State, Country" location string. We
// only keep professional geography; nothing here is sensitive.
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  if (!raw || typeof raw !== "string") {
    return { location: null, city: null, state: null, country: null };
  }

  const location = raw.replace(/\s+/g, " ").trim();
  if (!location) {
    return { location: null, city: null, state: null, country: null };
  }

  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { location, city: null, state: null, country: null };
  }

  if (parts.length === 1) {
    return { location, city: null, state: null, country: parts[0] };
  }

  if (parts.length === 2) {
    return { location, city: parts[0], state: null, country: parts[1] };
  }

  return {
    location,
    city: parts[0],
    state: parts[1],
    country: parts[parts.length - 1]
  };
}

export function buildFullName(firstName: string, lastName: string): string {
  return [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(" ").trim();
}
