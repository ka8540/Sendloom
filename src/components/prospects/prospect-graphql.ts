// Frontend GraphQL helper for the Prospect Graph dashboard (/prospects).
//
// It talks to the existing single endpoint POST /api/graphql. CSRF is handled
// globally by the window.fetch patch (see components/csrf-fetch-patch.tsx), so
// requests here only need to be same-origin POSTs with a JSON body — we never
// read or attach the CSRF token by hand, and we never weaken it.
//
// Both tables paginate server-side at exactly 10 rows per page so the page
// scales to 100+ searches/people without loading everything into the DOM.

export const PEOPLE_PAGE_SIZE = 10;
export const SEARCHES_PAGE_SIZE = 10;

export const GRAPHQL_ENDPOINT = "/api/graphql";

// ---------------------------------------------------------------------------
// Enums (mirrors src/graphql/schema.ts — kept as string unions on the client).
// ---------------------------------------------------------------------------

export type ProspectSearchStatus =
  | "DRAFT"
  | "RESOLVING_COMPANY"
  | "SEARCHING_PEOPLE"
  | "CLASSIFYING_POSITIONS"
  | "INFERRING_EMAIL_PATTERN"
  | "READY"
  | "FAILED"
  | "CANCELED";

export type PositionCategory =
  | "SOFTWARE_ENGINEERING"
  | "HUMAN_RESOURCES"
  | "DATA_ANALYTICS"
  | "DATA_ENGINEERING"
  | "DATA_SCIENCE"
  | "PRODUCT"
  | "DESIGN"
  | "MARKETING"
  | "SALES"
  | "FINANCE"
  | "OPERATIONS"
  | "RECRUITING"
  | "MANAGEMENT"
  | "OTHER";

export type EmailCandidateStatus =
  | "VERIFIED"
  | "INFERRED_HIGH"
  | "INFERRED_MEDIUM"
  | "INFERRED_LOW"
  | "UNAVAILABLE"
  | "SUPPRESSED"
  | "INVALID";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
export type ProspectSelectionMode = "EXPLICIT" | "ALL_MATCHING";

// ---------------------------------------------------------------------------
// Node shapes (only the fields this page selects).
// ---------------------------------------------------------------------------

export type CompanySummary = {
  id: string;
  name: string;
  officialDomain: string | null;
  officialWebsiteDomain: string | null;
  emailDomain: string | null;
  emailDomainConfidence: ConfidenceLevel;
  emailPattern: string | null;
  patternConfidence: ConfidenceLevel;
  peopleCount: number;
};

export type ProspectSearchNode = {
  id: string;
  requestedCompany: string;
  requestedTitles: string[];
  requestedLocations: string[];
  maxResults: number;
  status: ProspectSearchStatus;
  errorCode: string | null;
  errorMessage: string | null;
  peopleCount: number;
  /** True when no more unique people can be added (drives the Add-more button). */
  exhausted: boolean;
  createdAt: string;
  completedAt: string | null;
  company: CompanySummary | null;
};

export type DiscoverExpansionStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type DiscoverSearchExpansion = {
  id: string;
  searchId: string;
  status: DiscoverExpansionStatus;
  requestedCount: number;
  addedCount: number;
  totalPeopleCount: number;
  quotaRemaining: number;
  exhausted: boolean;
  message: string | null;
};

export type PositionNode = {
  id: string;
  category: PositionCategory;
  displayName: string;
  rawTitles: string[];
  peopleCount: number;
};

export type PatternEvidenceNode = {
  pattern: string;
  emailDomain: string | null;
  sourceUrl: string | null;
  sourceName: string;
  sourceType: string;
  percentage: number | null;
  confidence: ConfidenceLevel;
  observedAt: string | null;
};

export type EmailDomainEvidenceNode = {
  emailDomain: string;
  sourceUrl: string | null;
  sourceName: string;
  sourceType: string;
  observedPattern: string | null;
  percentage: number | null;
  confidence: ConfidenceLevel;
  observedAt: string | null;
};

export type CompanyDetail = {
  id: string;
  name: string;
  normalizedName: string;
  officialDomain: string | null;
  officialWebsiteDomain: string | null;
  officialWebsite: string | null;
  linkedinUrl: string | null;
  domainConfidence: ConfidenceLevel;
  emailDomain: string | null;
  emailDomainConfidence: ConfidenceLevel;
  emailDomainEvidence: EmailDomainEvidenceNode[];
  emailPattern: string | null;
  patternConfidence: ConfidenceLevel;
  emailFormatReason: string | null;
  emailFormatDiscoveredAt: string | null;
  peopleCount: number;
  patternEvidence: PatternEvidenceNode[];
  positions: PositionNode[];
};

export type PersonNode = {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  currentTitle: string | null;
  normalizedTitle: string | null;
  location: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  linkedinUrl: string;
  inferredEmail: string | null;
  emailStatus: EmailCandidateStatus;
  emailConfidence: ConfidenceLevel;
  emailPattern: string | null;
  emailSource: string | null;
  createdAt: string;
};

export type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type Connection<T> = {
  edges: Array<{ cursor: string; node: T }>;
  pageInfo: PageInfo;
  totalCount: number;
};

export type ProspectSelectionInput = {
  companyId: string;
  mode: ProspectSelectionMode;
  selectedIds?: string[] | null;
  excludedIds?: string[] | null;
  positionCategory?: PositionCategory | null;
};

export type ProspectSelectionReview = {
  selectedCount: number;
  exportableCount: number;
  unavailableEmailCount: number;
  suppressedCount: number;
  duplicateEmailCount: number;
};

export type PreparedProspectExport = {
  id: string;
  fileName: string;
  downloadUrl: string;
  review: ProspectSelectionReview;
};

export type ProspectImportResult = {
  importId: string;
  fileName: string;
  rowCount: number;
  viewUrl: string;
  review: ProspectSelectionReview;
};

export type DiscoverQuota = {
  resultsPerSearch: number;
  dailySearchLimit: number;
  searchesUsed: number;
  searchesRemaining: number;
  resetAt: string;
  /** Presentation-only — the backend re-decides exemption server-side. */
  unlimited: boolean;
};

// ---------------------------------------------------------------------------
// Queries (field names verified against src/graphql/schema.ts).
// ---------------------------------------------------------------------------

export const DISCOVER_QUOTA_QUERY = /* GraphQL */ `
  query DiscoverQuota {
    discoverQuota {
      resultsPerSearch
      dailySearchLimit
      searchesUsed
      searchesRemaining
      resetAt
      unlimited
    }
  }
`;

export const PROSPECT_SEARCHES_QUERY = /* GraphQL */ `
  query ProspectSearches($first: Int!, $after: String) {
    prospectSearches(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          requestedCompany
          requestedTitles
          requestedLocations
          maxResults
          status
          errorCode
          errorMessage
          peopleCount
          exhausted
          createdAt
          completedAt
          company {
            id
            name
            officialDomain
            officialWebsiteDomain
            emailDomain
            emailDomainConfidence
            emailPattern
            patternConfidence
            peopleCount
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

// Load a single user-owned search by id for the detail page. Uses the existing
// prospectSearch(id) resolver; resolves null when the id is unknown or owned by
// another user (the detail page then shows a safe not-found state).
export const PROSPECT_SEARCH_BY_ID_QUERY = /* GraphQL */ `
  query ProspectSearch($id: ID!) {
    prospectSearch(id: $id) {
      id
      requestedCompany
      requestedTitles
      requestedLocations
      maxResults
      status
      errorCode
      errorMessage
      peopleCount
      exhausted
      createdAt
      completedAt
      company {
        id
        name
        officialDomain
        officialWebsiteDomain
        emailDomain
        emailDomainConfidence
        emailPattern
        patternConfidence
        peopleCount
      }
    }
  }
`;

export const COMPANY_DETAIL_QUERY = /* GraphQL */ `
  query CompanyDetail($id: ID!) {
    company(id: $id) {
      id
      name
      normalizedName
      officialDomain
      officialWebsiteDomain
      officialWebsite
      linkedinUrl
      domainConfidence
      emailDomain
      emailDomainConfidence
      emailDomainEvidence {
        emailDomain
        sourceUrl
        sourceName
        sourceType
        observedPattern
        percentage
        confidence
        observedAt
      }
      emailPattern
      patternConfidence
      emailFormatReason
      emailFormatDiscoveredAt
      peopleCount
      patternEvidence {
        pattern
        emailDomain
        sourceUrl
        sourceName
        sourceType
        percentage
        confidence
        observedAt
      }
      positions {
        id
        category
        displayName
        rawTitles
        peopleCount
      }
    }
  }
`;

export const PEOPLE_QUERY = /* GraphQL */ `
  query People($companyId: ID!, $category: PositionCategory, $first: Int!, $after: String) {
    people(companyId: $companyId, positionCategory: $category, first: $first, after: $after) {
      totalCount
      edges {
        cursor
        node {
          id
          fullName
          firstName
          lastName
          currentTitle
          normalizedTitle
          location
          country
          state
          city
          linkedinUrl
          inferredEmail
          emailStatus
          emailConfidence
          emailPattern
          emailSource
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Optional, intentionally minimal mutations (create / process / cancel).
export const CREATE_SEARCH_MUTATION = /* GraphQL */ `
  mutation CreateProspectSearch($input: CreateProspectSearchInput!) {
    createProspectSearch(input: $input) {
      id
      status
      requestedCompany
    }
  }
`;

export const PROCESS_SEARCH_MUTATION = /* GraphQL */ `
  mutation ProcessProspectSearch($id: ID!) {
    processProspectSearch(id: $id) {
      id
      status
      errorCode
      errorMessage
      company {
        id
        name
        officialDomain
        officialWebsiteDomain
        emailDomain
        emailDomainConfidence
        emailPattern
        patternConfidence
        peopleCount
      }
    }
  }
`;

export const CANCEL_SEARCH_MUTATION = /* GraphQL */ `
  mutation CancelProspectSearch($id: ID!) {
    cancelProspectSearch(id: $id) {
      id
      status
    }
  }
`;

export const ADD_MORE_DISCOVER_PEOPLE_MUTATION = /* GraphQL */ `
  mutation AddMoreDiscoverPeople($searchId: ID!, $idempotencyKey: String!) {
    addMoreDiscoverPeople(searchId: $searchId, idempotencyKey: $idempotencyKey) {
      id
      searchId
      status
      requestedCount
      addedCount
      totalPeopleCount
      quotaRemaining
      exhausted
      message
    }
  }
`;

export const DELETE_COMPANY_MUTATION = /* GraphQL */ `
  mutation DeleteCompany($companyId: ID!) {
    deleteCompany(companyId: $companyId)
  }
`;

export const REFRESH_COMPANY_EMAIL_FORMAT_MUTATION = /* GraphQL */ `
  mutation RefreshCompanyEmailFormat($companyId: ID!, $sourceUrl: String) {
    refreshCompanyEmailFormat(companyId: $companyId, sourceUrl: $sourceUrl) {
      id
      name
      officialDomain
      officialWebsiteDomain
      officialWebsite
      linkedinUrl
      domainConfidence
      emailDomain
      emailDomainConfidence
      emailDomainEvidence {
        emailDomain
        sourceUrl
        sourceName
        sourceType
        observedPattern
        percentage
        confidence
        observedAt
      }
      emailPattern
      patternConfidence
      emailFormatReason
      emailFormatDiscoveredAt
      peopleCount
      patternEvidence {
        pattern
        emailDomain
        sourceUrl
        sourceName
        sourceType
        percentage
        confidence
        observedAt
      }
      positions {
        id
        category
        displayName
        rawTitles
        peopleCount
      }
    }
  }
`;

export const DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION = /* GraphQL */ `
  mutation DiscoverCompanyEmailFormat($companyId: ID!, $force: Boolean) {
    discoverCompanyEmailFormat(companyId: $companyId, force: $force) {
      id
      name
      officialDomain
      officialWebsiteDomain
      officialWebsite
      linkedinUrl
      domainConfidence
      emailDomain
      emailDomainConfidence
      emailDomainEvidence {
        emailDomain
        sourceUrl
        sourceName
        sourceType
        observedPattern
        percentage
        confidence
        observedAt
      }
      emailPattern
      patternConfidence
      emailFormatReason
      emailFormatDiscoveredAt
      peopleCount
      patternEvidence {
        pattern
        emailDomain
        sourceUrl
        sourceName
        sourceType
        percentage
        confidence
        observedAt
      }
      positions {
        id
        category
        displayName
        rawTitles
        peopleCount
      }
    }
  }
`;

export const SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION = /* GraphQL */ `
  mutation SetCompanyEmailInferenceOverride(
    $companyId: ID!
    $emailDomain: String!
    $emailPattern: String!
    $confidence: ConfidenceLevel!
    $reason: String
  ) {
    setCompanyEmailInferenceOverride(
      companyId: $companyId
      emailDomain: $emailDomain
      emailPattern: $emailPattern
      confidence: $confidence
      reason: $reason
    ) {
      id
      name
      officialDomain
      officialWebsiteDomain
      officialWebsite
      linkedinUrl
      domainConfidence
      emailDomain
      emailDomainConfidence
      emailDomainEvidence {
        emailDomain
        sourceUrl
        sourceName
        sourceType
        observedPattern
        percentage
        confidence
        observedAt
      }
      emailPattern
      patternConfidence
      emailFormatReason
      emailFormatDiscoveredAt
      peopleCount
      patternEvidence {
        pattern
        emailDomain
        sourceUrl
        sourceName
        sourceType
        percentage
        confidence
        observedAt
      }
      positions {
        id
        category
        displayName
        rawTitles
        peopleCount
      }
    }
  }
`;

export const REVIEW_PROSPECT_SELECTION_MUTATION = /* GraphQL */ `
  mutation ReviewProspectSelection($input: ProspectSelectionInput!) {
    reviewProspectSelection(input: $input) {
      selectedCount
      exportableCount
      unavailableEmailCount
      suppressedCount
      duplicateEmailCount
    }
  }
`;

export const PREPARE_PROSPECT_EXPORT_MUTATION = /* GraphQL */ `
  mutation PrepareProspectExport($input: ProspectSelectionInput!) {
    prepareProspectExport(input: $input) {
      id
      fileName
      downloadUrl
      review {
        selectedCount
        exportableCount
        unavailableEmailCount
        suppressedCount
        duplicateEmailCount
      }
    }
  }
`;

export const CREATE_PROSPECT_IMPORT_MUTATION = /* GraphQL */ `
  mutation CreateProspectImport($input: ProspectSelectionInput!) {
    createProspectImport(input: $input) {
      importId
      fileName
      rowCount
      viewUrl
      review {
        selectedCount
        exportableCount
        unavailableEmailCount
        suppressedCount
        duplicateEmailCount
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Variable builders — both tables default to 10 rows per page.
// ---------------------------------------------------------------------------

export type PeopleQueryVariables = {
  companyId: string;
  category?: PositionCategory | null;
  first: number;
  after?: string | null;
};

/**
 * Build the variables for the People query. `first` defaults to
 * PEOPLE_PAGE_SIZE (10). A null/"All people" category is sent as null so the
 * backend returns every category.
 */
export function buildPeopleVariables(args: {
  companyId: string;
  category?: PositionCategory | null;
  first?: number;
  after?: string | null;
}): PeopleQueryVariables {
  return {
    companyId: args.companyId,
    category: args.category ?? null,
    first: args.first ?? PEOPLE_PAGE_SIZE,
    after: args.after ?? null
  };
}

export function buildSearchesVariables(args?: { first?: number; after?: string | null }) {
  return {
    first: args?.first ?? SEARCHES_PAGE_SIZE,
    after: args?.after ?? null
  };
}

// ---------------------------------------------------------------------------
// Request wrapper.
// ---------------------------------------------------------------------------

export type GraphQLResult<T> = {
  data: T | null;
  /** True when the feature flag is off (route returns 404 / disabled JSON). */
  disabled: boolean;
  /** A single user-safe error message, or null. Never raw provider detail. */
  error: string | null;
  /** The first error's safe extension code (e.g. DISCOVER_DAILY_LIMIT_REACHED). */
  errorCode: string | null;
};

type RawGraphQLResponse<T> = {
  data?: T | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

const SAFE_GRAPHQL_ERROR_CODES = new Set([
  "BAD_USER_INPUT",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "DISCOVER_DAILY_LIMIT_REACHED",
  "DISCOVER_EXPANSION_ALREADY_RUNNING",
  "DISCOVER_EXPANSION_FAILED"
]);

function safeGraphqlErrorMessage(errors: NonNullable<RawGraphQLResponse<unknown>["errors"]>): string {
  const first = errors[0];
  const code = first?.extensions?.code;
  const message = first?.message?.trim();
  if (
    code &&
    SAFE_GRAPHQL_ERROR_CODES.has(code) &&
    message &&
    message.length <= 240 &&
    !/\b(prisma|secret|token|bearer|stack|password)\b/i.test(message)
  ) {
    return message;
  }
  return "We couldn't complete that request.";
}

/**
 * Detect the "feature disabled" signal. The route returns HTTP 404 with
 * `{ error: "Prospect graph is not enabled." }` when PROSPECT_GRAPH_ENABLED is
 * off. We treat any 404 from this endpoint as disabled.
 */
export function isDisabledResponse(status: number, body: unknown): boolean {
  if (status === 404) {
    return true;
  }
  if (body && typeof body === "object" && "error" in body) {
    const message = String((body as { error?: unknown }).error ?? "");
    return /not enabled/i.test(message);
  }
  return false;
}

/**
 * Execute a GraphQL operation against /api/graphql. Returns a normalized result
 * that the UI can branch on without ever surfacing raw transport/GraphQL error
 * text to the user.
 */
export async function prospectGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<GraphQLResult<T>> {
  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal
    });
  } catch {
    return {
      data: null,
      disabled: false,
      error: "Network error. Check your connection and try again.",
      errorCode: null
    };
  }

  let body: RawGraphQLResponse<T> | { error?: string } | null = null;
  try {
    body = (await response.json()) as RawGraphQLResponse<T>;
  } catch {
    body = null;
  }

  if (isDisabledResponse(response.status, body)) {
    return { data: null, disabled: true, error: null, errorCode: null };
  }

  if (!response.ok) {
    return {
      data: null,
      disabled: false,
      error: "The prospect service is unavailable right now.",
      errorCode: null
    };
  }

  const raw = (body ?? {}) as RawGraphQLResponse<T>;
  if (raw.errors && raw.errors.length > 0) {
    const code = raw.errors[0]?.extensions?.code ?? null;
    return { data: raw.data ?? null, disabled: false, error: safeGraphqlErrorMessage(raw.errors), errorCode: code };
  }

  return { data: raw.data ?? null, disabled: false, error: null, errorCode: null };
}
