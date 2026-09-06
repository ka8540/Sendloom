import { canonicalizeLinkedInProfileUrl } from "./linkedin-profile-url";
// Stable person identity for Discover "Add 10 more". The expansion must never
// add the same person twice to a search, and must never collapse two different
// people who merely share a name. We therefore key identity on durable provider
// signals only, in priority order:
//   1. the normalized provider profile id (sourceProfileId)
//   2. the normalized LinkedIn / source profile URL
// A candidate is a duplicate of an existing person when they share ANY of these
// keys, so a match on either the provider id OR the profile URL deduplicates.

export type PersonIdentitySource = {
  sourceProfileId?: string | null;
  linkedinUrl?: string | null;
};

/**
 * Normalize a LinkedIn / source profile URL for comparison: lowercase, trim,
 * drop the query string and fragment, strip the protocol and a leading "www.",
 * and remove any trailing slash. Returns null when there is nothing usable.
 */
export function normalizeProfileUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const canonical = canonicalizeLinkedInProfileUrl(url);
  if (canonical) return canonical.linkedinUrl.replace("https://", "");
  let value = url.trim().toLowerCase();
  if (!value) {
    return null;
  }
  value = value.split("#")[0];
  value = value.split("?")[0];
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.replace(/\/+$/, "");
  return value || null;
}

/** Normalize a provider profile id (trim + lowercase) for comparison. */
function normalizeSourceProfileId(id: string | null | undefined): string | null {
  const value = id?.trim().toLowerCase();
  return value ? value : null;
}

/**
 * Every identity key a person matches. Used both to build the set of identities
 * already attached to a search and to test a candidate against that set. A
 * person with neither a provider id nor a usable URL yields no keys and can
 * never be deduplicated against (it is always treated as new).
 */
export function personIdentityKeys(person: PersonIdentitySource): string[] {
  const keys: string[] = [];
  const id = normalizeSourceProfileId(person.sourceProfileId);
  if (id) {
    keys.push(`id:${id}`);
  }
  const url = normalizeProfileUrl(person.linkedinUrl);
  if (url) {
    keys.push(`url:${url}`);
  }
  return keys;
}

/** A reusable set of identities, with helpers to test/add people. */
export class PersonIdentitySet {
  private readonly keys = new Set<string>();

  constructor(people: Iterable<PersonIdentitySource> = []) {
    for (const person of people) {
      this.add(person);
    }
  }

  /** True when the person already matches a known identity. */
  has(person: PersonIdentitySource): boolean {
    return personIdentityKeys(person).some((key) => this.keys.has(key));
  }

  /** Record every identity key for a person. */
  add(person: PersonIdentitySource): void {
    for (const key of personIdentityKeys(person)) {
      this.keys.add(key);
    }
  }

  /** Test-and-add: returns true if the person was new (and records it). */
  addIfNew(person: PersonIdentitySource): boolean {
    if (this.has(person)) {
      return false;
    }
    this.add(person);
    return true;
  }
}
