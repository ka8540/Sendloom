// THE authoritative person-name parser for Discover.
//
// Every Discover surface that needs a person's name components — provider
// ingestion, the shared cache, user materialization, inferred-email generation,
// and the repair backfill — goes through `parsePersonName` here. There is
// deliberately ONE implementation: scattering "strip MBA / strip emoji" regexes
// across the pipeline is how a display name like "Jared Cho M.B.A." became the
// email jared.chomba@apple.com.
//
// The model is an identity, not a string cleanup. A raw display name is reduced
// to canonical components plus an explicit completeness `status`, and email
// generation is only ever allowed to use the components the status vouches for.
// An identity we cannot establish yields NO email — a missing address is always
// preferable to a confidently wrong one.
//
// Everything here is pure and deterministic: no network, no AI, no I/O. The AI
// fallback for genuinely incomplete identities lives in
// openai-person-identity-resolution.ts and only runs when this parser reports
// AMBIGUOUS or INCOMPLETE.

import { stripDiacritics } from "@/services/prospects/prospect-normalization";

/**
 * How much of a usable professional identity we could establish.
 *
 *  - COMPLETE   — a full given name and a full family name. Safe to generate.
 *  - AMBIGUOUS  — a component is known only as an initial ("Jared C.", "J. Cho").
 *                 Surname-dependent (respectively first-name-dependent) emails
 *                 are withheld; the AI resolver may be able to complete it.
 *  - INCOMPLETE — a given name with no family-name token at all ("Jared").
 *  - UNUSABLE   — nothing name-like survived sanitization.
 */
export type PersonIdentityStatus = "COMPLETE" | "AMBIGUOUS" | "INCOMPLETE" | "UNUSABLE";

export type PersonIdentity = {
  /** Full given name, or null when only an initial (or nothing) is known. */
  firstName: string | null;
  /** Full family name, or null when only an initial (or nothing) is known. */
  lastName: string | null;
  /**
   * The given-name initial. Populated even when `firstName` is null, so a
   * pattern that needs only an initial ("f.last") still works for "J. Cho".
   */
  firstInitial: string | null;
  /**
   * Clean, human-readable display name. Emoji and credentials are gone, but a
   * parenthetical alias and an unresolved surname initial are PRESERVED — this
   * is what a person reads, not what an email is built from.
   */
  fullName: string;
  /**
   * Alternate given names found in parentheses ("Jared (Yiming) Cho"). Recorded
   * for human context only. These NEVER feed email generation on their own: an
   * alternate is used only when the AI resolver returns it as the person's
   * established professional given name.
   */
  alternateFirstNames: string[];
  status: PersonIdentityStatus;
  /** Short, PII-free explanation of the status. Safe to log. */
  reason: string;
};

export type PersonNameInput = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
};

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

// Academic/professional credentials that are never plausible family names, so a
// trailing occurrence is always decoration ("Jared Cho MBA").
const UNAMBIGUOUS_CREDENTIALS = new Set([
  "mba", "emba", "phd", "dphil", "edd", "psyd", "scd", "mfa", "mph", "mpa", "mpp", "msw",
  "jd", "llm", "llb", "esq", "cpa", "cfa", "cfp", "cpc", "pmp", "cissp", "cisa", "cism",
  "csm", "cspo", "safe", "itil", "ccna", "ccnp", "mcse", "sphr", "phr", "shrm", "cscp",
  "dds", "dmd", "dvm", "dnp", "mbbs", "bds", "pharmd", "otr", "lpc", "lcsw", "lmft",
  "bsc", "msc", "bba", "bfa", "beng", "meng", "beds", "aas", "beit", "beit"
]);

// Credentials that are ALSO real family names ("Li Ma", "Jane Do", "Amy Ba").
// These are only decoration when written in a credential SHAPE — all-caps or
// dotted ("M.S.") — and are never stripped when doing so would leave the person
// without a surname. This is the guard that keeps "Li Ma" intact.
const AMBIGUOUS_CREDENTIALS = new Set([
  "ma", "ms", "md", "ba", "bs", "be", "do", "pe", "rn", "np", "pa", "ca", "ce", "pt"
]);

// Generational suffixes. Trailing-only, and never stripped down to a lone token.
const GENERATIONAL_SUFFIXES = new Set(["jr", "jnr", "sr", "snr", "ii", "iii", "iv", "v", "vi"]);

// Leading honorifics ("Dr. Jared Cho").
const HONORIFICS = new Set([
  "dr", "mr", "mrs", "ms", "mx", "miss", "prof", "professor", "sir", "dame",
  "rev", "fr", "hon", "capt", "col", "sgt", "lt"
]);

// Nobiliary / patronymic particles that belong to the FAMILY name, so a
// multi-part surname survives ("Jan van der Meer", "María de la Cruz").
const SURNAME_PARTICLES = new Set([
  "de", "del", "dela", "della", "der", "den", "di", "da", "das", "dos", "du",
  "la", "le", "les", "lo", "van", "von", "vander", "ten", "ter", "af", "av",
  "bin", "ibn", "bint", "al", "el", "st", "santa", "santo", "mc", "mac", "abu"
]);

// Parenthetical content that is decoration, not an alternate given name.
const PRONOUN_TOKENS = new Set([
  "he", "him", "his", "she", "her", "hers", "they", "them", "their", "theirs",
  "ze", "zie", "hir", "xe", "ey", "per", "it", "its"
]);

const PARENTHETICAL_NOISE = new Set([
  "retired", "hiring", "remote", "open", "opentowork", "available", "seeking",
  "former", "ex", "freelance", "contract", "consultant", "intern", "alumni",
  "veteran", "founder", "student", "candidate", "phd"
]);

// ---------------------------------------------------------------------------
// Character-level sanitization
// ---------------------------------------------------------------------------

// Emoji, pictographs, decorative symbols, skin-tone modifiers, variation
// selectors, and zero-width/format characters. Letters, marks, apostrophes and
// hyphens are untouched, so "María", "O’Brien" and "Smith-Jones" survive intact.
const DECORATION_PATTERN =
  /[\p{Extended_Pictographic}\p{So}\p{Cf}\p{Emoji_Modifier}︀-️‍]/gu;

// Characters that can never be part of a name once decorations are gone. Kept
// deliberately narrow: letters, marks, digits (for generational "II"), spaces,
// and the punctuation a real name or a credential can carry.
const NON_NAME_PATTERN = /[^\p{L}\p{M}\p{Nd}\s'’.,()\-‐-―/]/gu;

/** Strip decorations and collapse whitespace. Never used for email local parts. */
function sanitizeRaw(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(DECORATION_PATTERN, " ")
    .replace(NON_NAME_PATTERN, " ")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tidy the spacing punctuation leaves behind, for display only. */
function tidyDisplay(value: string): string {
  return value
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)/g, ")")
    .replace(/\s+,/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-]+|[\s,\-]+$/g, "")
    .trim();
}

/** Lowercase, accent-folded, letters-only form of a token (its identity key). */
function tokenKey(token: string): string {
  return stripDiacritics(token).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Token classification
// ---------------------------------------------------------------------------

/** True when a token is a bare initial: "J", "J.", "J-" — one letter, no more. */
function isInitialToken(token: string): boolean {
  const key = tokenKey(token);
  return key.length === 1 && /\p{L}/u.test(key);
}

/** A credential written in credential shape: ALL CAPS ("MBA") or dotted ("M.B.A."). */
function hasCredentialShape(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) {
    return false;
  }
  // "M.B.A." / "Ph.D." — interior periods are never part of a family name.
  if (/\p{L}\.\p{L}/u.test(token) || /\p{L}\p{L}+\./u.test(token)) {
    return true;
  }
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

type DecorationKind = "credential" | "generational" | "none";

/**
 * Classify a token as removable decoration. `ambiguous` credentials (real
 * surnames like "Ma") only count when written in credential shape — the caller
 * additionally refuses to strip them down to a nameless identity.
 */
function decorationKind(token: string): DecorationKind {
  const key = tokenKey(token);
  if (!key) {
    return "none";
  }
  if (UNAMBIGUOUS_CREDENTIALS.has(key)) {
    return "credential";
  }
  if (AMBIGUOUS_CREDENTIALS.has(key) && hasCredentialShape(token)) {
    return "credential";
  }
  if (GENERATIONAL_SUFFIXES.has(key)) {
    return "generational";
  }
  return "none";
}

/**
 * True when a credential may be removed even if it is the last token standing.
 * "MBA" can never be someone's surname, so "Jared MBA" is legitimately just
 * "Jared" (INCOMPLETE). "Ma" can be, so it always stays.
 */
function isAlwaysRemovable(token: string): boolean {
  return UNAMBIGUOUS_CREDENTIALS.has(tokenKey(token));
}

// ---------------------------------------------------------------------------
// Parenthetical alternate given names
// ---------------------------------------------------------------------------

type ParentheticalSplit = { withoutParentheticals: string; alternates: string[] };

/**
 * Pull "(...)" groups out of a name and decide which are alternate GIVEN names.
 *
 * "Jared (Yiming) Cho" carries a real alternate given name; "Jared (he/him) Cho"
 * and "Jared (MBA) Cho" carry pronouns and a credential. Only a single clean
 * alphabetic token qualifies, because a false positive here would put a stray
 * word into a person's identity. Note that alternates are never sufficient on
 * their own to generate an address, so the conservative rule costs nothing.
 */
function splitParentheticals(value: string): ParentheticalSplit {
  const alternates: string[] = [];
  const withoutParentheticals = value.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    const content = String(inner).trim();
    if (content.includes("/")) {
      return " ";
    }
    const tokens = content.split(/\s+/).filter(Boolean);
    if (tokens.length !== 1) {
      return " ";
    }
    const [token] = tokens;
    const key = tokenKey(token);
    if (
      key.length < 2 ||
      key.length > 24 ||
      !/^\p{L}[\p{L}\p{M}'’-]*$/u.test(token) ||
      PRONOUN_TOKENS.has(key) ||
      PARENTHETICAL_NOISE.has(key) ||
      decorationKind(token) !== "none" ||
      HONORIFICS.has(key)
    ) {
      return " ";
    }
    alternates.push(token);
    return " ";
  });

  return { withoutParentheticals, alternates };
}

// ---------------------------------------------------------------------------
// Decoration stripping
// ---------------------------------------------------------------------------

/**
 * Drop comma-attached credential tails ("Jared Cho, MBA, PMP"). A comma segment
 * is only removed when EVERY token in it is decoration — an unrecognized tail is
 * kept rather than guessed at.
 */
function dropCredentialCommaSegments(value: string): string {
  const segments = value.split(",").map((segment) => segment.trim());
  if (segments.length <= 1) {
    return value;
  }
  const [head, ...rest] = segments;
  const kept = rest.filter((segment) => {
    if (!segment) {
      return false;
    }
    const tokens = segment.split(/\s+/).filter(Boolean);
    return !tokens.every((token) => decorationKind(token) !== "none");
  });
  return [head, ...kept].filter(Boolean).join(" ");
}

/**
 * Remove leading honorifics and trailing credential/generational decoration
 * from a token list.
 *
 * The single most important rule lives here: a trailing token is never stripped
 * when doing so would leave the person with no surname, unless the token is a
 * credential that could never be a surname. That is what keeps "Li Ma" → Li Ma
 * while still reducing "Jared Cho M.B.A." → Jared Cho and "Jared MBA" → Jared.
 *
 * `minTokens` is how many tokens that floor is. A display name needs 2 (a given
 * name AND a family name), while a standalone family-name field needs only 1 —
 * every token in it is already surname, so "Doe Jr." safely becomes "Doe".
 */
function stripDecorationTokens(tokens: string[], minTokens = 2): string[] {
  let result = [...tokens];

  // Leading honorific: "Dr. Jared Cho". Requires either dotted form or enough
  // tokens left over that we are plainly not eating the given name.
  while (result.length >= 2) {
    const [head] = result;
    if (!HONORIFICS.has(tokenKey(head))) {
      break;
    }
    if (!head.includes(".") && result.length < 3) {
      break;
    }
    result = result.slice(1);
  }

  // Trailing decoration, innermost last: "Jared Cho, Ph.D." / "Jared Cho MBA".
  while (result.length > 0) {
    const tail = result[result.length - 1];
    if (decorationKind(tail) === "none") {
      break;
    }
    if (result.length <= minTokens && !isAlwaysRemovable(tail)) {
      // Removing this would destroy the only surname candidate. "Li Ma" stays.
      break;
    }
    result = result.slice(0, -1);
  }

  return result;
}

function nameTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.replace(/^[,.\-]+|[,]+$/g, "").trim())
    .filter((token) => token.length > 0 && /\p{L}|\p{Nd}/u.test(token));
}

// ---------------------------------------------------------------------------
// Structural parsing
// ---------------------------------------------------------------------------

type NameParts = {
  first: string | null;
  firstInitial: string | null;
  last: string | null;
  /** True when a family-name token exists but is only an initial ("Jared C."). */
  lastIsInitial: boolean;
};

/**
 * Find where the family name starts, walking back over nobiliary particles so a
 * legitimate multi-part surname is preserved. Middle names and middle initials
 * sit between the given name and this index and are deliberately DISCARDED —
 * "Jared M. Cho" and "Jared Michael Cho" both have the family name "Cho".
 */
function familyNameStart(tokens: string[]): number {
  let start = tokens.length - 1;
  while (start > 1) {
    const previous = tokens[start - 1];
    if (!SURNAME_PARTICLES.has(tokenKey(previous))) {
      break;
    }
    start -= 1;
  }
  return start;
}

/** Structural parse of a whitespace-separated, already-decluttered name. */
function parseTokens(tokens: string[]): NameParts {
  if (tokens.length === 0) {
    return { first: null, firstInitial: null, last: null, lastIsInitial: false };
  }

  const [head] = tokens;
  const headIsInitial = isInitialToken(head);
  const first = headIsInitial ? null : head;
  const firstInitial = tokenKey(head)[0] ?? null;

  if (tokens.length === 1) {
    return { first, firstInitial, last: null, lastIsInitial: false };
  }

  const start = familyNameStart(tokens);
  const familyTokens = tokens.slice(start);
  const lastIsInitial = familyTokens.length === 1 && isInitialToken(familyTokens[0]);

  return {
    first,
    firstInitial,
    last: lastIsInitial ? null : familyTokens.join(" "),
    lastIsInitial
  };
}

/**
 * Clean a provider-supplied structured `lastName` into a family name.
 *
 * Providers are not trustworthy here: the same field arrives as "Cho",
 * "Cho M.B.A.", "(Yiming) Cho", or "M. Cho" (the old naive full-name split).
 * Leading initials and middle names are dropped, decoration is stripped, and an
 * initial-only value is rejected outright.
 */
function parseProviderLastName(raw: string): { last: string | null; isInitial: boolean } {
  const { withoutParentheticals } = splitParentheticals(sanitizeRaw(raw));
  const tokens = stripDecorationTokens(nameTokens(dropCredentialCommaSegments(withoutParentheticals)), 1);
  if (tokens.length === 0) {
    return { last: null, isInitial: false };
  }

  // Unlike a display name, EVERY token in this field is family name — there is
  // no given name to walk past. Only bare initials are dropped, which repairs
  // the "M. Cho" values the old naive full-name split used to produce.
  const kept = tokens.filter((token) => !isInitialToken(token));
  if (kept.length === 0) {
    return { last: null, isInitial: true };
  }
  return { last: kept.join(" "), isInitial: false };
}

/** Reduce a provider-supplied structured `firstName` to a single given name. */
function parseProviderFirstName(raw: string): { first: string | null; initial: string | null } {
  const { withoutParentheticals } = splitParentheticals(sanitizeRaw(raw));
  const tokens = stripDecorationTokens(nameTokens(dropCredentialCommaSegments(withoutParentheticals)), 1);
  if (tokens.length === 0) {
    return { first: null, initial: null };
  }
  const [head] = tokens;
  return {
    first: isInitialToken(head) ? null : head,
    initial: tokenKey(head)[0] ?? null
  };
}

/**
 * Pick the family name when both the provider field and the display name offer
 * one. Provider structure is the stronger signal and wins by default.
 *
 * The one exception is the extra leading tokens when one form contains the
 * other: nobiliary particles BELONG to the family name, so the longer form wins
 * ("van der Meer" is never truncated to "Meer"), while an ordinary extra word is
 * a middle name and must not be glued onto the surname ("Jared Michael Cho" has
 * the family name "Cho", never "Michael Cho").
 */
function chooseLastName(providerLast: string | null, parsedLast: string | null): string | null {
  if (!providerLast) {
    return parsedLast;
  }
  if (!parsedLast) {
    return providerLast;
  }

  const providerKey = tokenKey(providerLast);
  const parsedKey = tokenKey(parsedLast);
  if (providerKey === parsedKey) {
    return providerLast;
  }

  const [longer, shorter] =
    providerKey.length >= parsedKey.length ? [providerLast, parsedLast] : [parsedLast, providerLast];
  if (!tokenKey(longer).endsWith(tokenKey(shorter))) {
    return providerLast;
  }

  const longerTokens = longer.split(" ");
  const extraTokens = longerTokens.slice(0, longerTokens.length - shorter.split(" ").length);
  return extraTokens.length > 0 && extraTokens.every((token) => SURNAME_PARTICLES.has(tokenKey(token)))
    ? longer
    : shorter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw provider name fields into a canonical professional identity.
 *
 * Priority order: sanitize everything, trust structured provider fields when
 * they are STRUCTURALLY valid, and use the display name both to fill gaps and to
 * repair polluted structured values. Nothing is ever inferred from ethnicity,
 * nationality, or assumptions about cultural name ordering.
 */
export function parsePersonName(input: PersonNameInput): PersonIdentity {
  const rawFull = sanitizeRaw(input.fullName);
  const rawFirst = sanitizeRaw(input.firstName);
  const rawLast = sanitizeRaw(input.lastName);

  const displaySource = rawFull || [rawFirst, rawLast].filter(Boolean).join(" ");
  const { withoutParentheticals, alternates } = splitParentheticals(displaySource);
  const structuralTokens = stripDecorationTokens(
    nameTokens(dropCredentialCommaSegments(withoutParentheticals))
  );
  const parsed = parseTokens(structuralTokens);

  const providerFirst = rawFirst ? parseProviderFirstName(rawFirst) : { first: null, initial: null };
  const providerLast = rawLast ? parseProviderLastName(rawLast) : { last: null, isInitial: false };

  // When there is no display name, the source string is synthesized from the
  // structured fields — so a lastName-only record must not have its family name
  // read back as a given name. Roles come from the field they arrived in.
  const hasGivenNameSource = Boolean(rawFull || rawFirst);
  const firstName = providerFirst.first ?? (hasGivenNameSource ? parsed.first : null);
  const firstInitial = providerFirst.initial ?? (hasGivenNameSource ? parsed.firstInitial : null);
  const lastName = chooseLastName(providerLast.last, hasGivenNameSource ? parsed.last : null);

  // A surname token exists but is only an initial — the distinction that keeps
  // "Jared C." out of jared.c@company.com.
  const lastIsInitial = !lastName && (parsed.lastIsInitial || providerLast.isInitial);

  // Display form: decoration removed, alias and unresolved surname initial
  // preserved. A person still reads "Jared C." even though no email follows.
  const displayBase = structuralTokens.join(" ") || [firstName, lastName].filter(Boolean).join(" ");
  const fullName =
    tidyDisplay(alternates.length > 0 ? insertAlternate(displayBase, alternates) : displayBase) ||
    tidyDisplay(displaySource);

  const { status, reason } = resolveStatus({
    firstName,
    firstInitial,
    lastName,
    lastIsInitial
  });

  return {
    firstName,
    lastName,
    firstInitial,
    fullName,
    alternateFirstNames: alternates,
    status,
    reason
  };
}

/**
 * Re-insert the parenthetical alias after the given name so the display form
 * stays recognizable ("Jared (Yiming) Cho") without ever entering the tokens
 * email generation consumes.
 */
function insertAlternate(displayBase: string, alternates: string[]): string {
  const tokens = displayBase.split(" ");
  if (tokens.length === 0) {
    return displayBase;
  }
  const [head, ...rest] = tokens;
  return [head, `(${alternates.join(" ")})`, ...rest].join(" ");
}

function resolveStatus(parts: {
  firstName: string | null;
  firstInitial: string | null;
  lastName: string | null;
  lastIsInitial: boolean;
}): { status: PersonIdentityStatus; reason: string } {
  if (!parts.firstName && !parts.firstInitial) {
    return { status: "UNUSABLE", reason: "No usable given name survived sanitization." };
  }
  if (parts.lastIsInitial) {
    return {
      status: "AMBIGUOUS",
      reason: "The family name is only an initial, so surname-based addresses are withheld."
    };
  }
  if (!parts.lastName) {
    return { status: "INCOMPLETE", reason: "No family name was supplied." };
  }
  if (!parts.firstName) {
    return {
      status: "AMBIGUOUS",
      reason: "The given name is only an initial, so full-first-name addresses are withheld."
    };
  }
  return { status: "COMPLETE", reason: "A full given name and family name were established." };
}

/** True when the identity supports generating a surname-based business email. */
export function isIdentityUsableForEmail(identity: PersonIdentity): boolean {
  return identity.status === "COMPLETE";
}

/** True when the AI identity resolver is worth invoking for this person. */
export function identityNeedsResolution(identity: PersonIdentity): boolean {
  return identity.status === "AMBIGUOUS" || identity.status === "INCOMPLETE";
}

// ---------------------------------------------------------------------------
// Email local-part tokens
// ---------------------------------------------------------------------------

export type NameTokens = {
  /** Lowercase ascii given name for an email local part, or null. */
  first: string | null;
  /** Lowercase ascii family name for an email local part, or null. */
  last: string | null;
  /**
   * Given-name initial. Set even when `first` is null (an initial-only given
   * name can still satisfy "f.last"). NEVER set from an unresolved surname
   * initial — that is the whole point of withholding "jc@company.com".
   */
  firstInitial: string | null;
};

/** Fold one canonical component into an ascii email local-part token. */
function emailToken(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const token = stripDiacritics(value)
    .toLowerCase()
    .replace(/['’]/g, "") // O'Brien -> obrien
    .replace(/[-\s]+/g, "") // Smith-Jones / "de la Cruz" -> collapse
    .replace(/[^a-z]/g, "")
    .trim();
  return token || null;
}

/** Build email local-part tokens from an already-canonical identity. */
export function identityToEmailTokens(identity: PersonIdentity): NameTokens {
  const first = emailToken(identity.firstName);
  const last = emailToken(identity.lastName);
  const firstInitial = first ? first[0] : emailToken(identity.firstInitial);
  return { first, last, firstInitial };
}

/**
 * Convert raw first/last values into email local-part tokens.
 *
 * This is the safety net for rows written before the identity pipeline existed:
 * it re-parses through `parsePersonName`, so a stored lastName of "Cho M.B.A."
 * or "C." can never reach an email local part. Freshly ingested people already
 * carry canonical components, and re-parsing them is a no-op.
 */
export function normalizeNameForEmail(firstName: string, lastName: string): NameTokens {
  return identityToEmailTokens(parsePersonName({ firstName, lastName }));
}
