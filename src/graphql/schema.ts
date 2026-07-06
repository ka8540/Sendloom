// GraphQL SDL for the prospect graph. The enum values intentionally mirror the
// string constants in @/lib/prospect-enums so the database, services, and API
// all share one vocabulary.

export const typeDefs = /* GraphQL */ `
  scalar DateTime

  enum ProspectSearchStatus {
    DRAFT
    RESOLVING_COMPANY
    SEARCHING_PEOPLE
    CLASSIFYING_POSITIONS
    INFERRING_EMAIL_PATTERN
    READY
    FAILED
    CANCELED
  }

  enum PositionCategory {
    SOFTWARE_ENGINEERING
    HUMAN_RESOURCES
    DATA_ANALYTICS
    DATA_ENGINEERING
    DATA_SCIENCE
    PRODUCT
    DESIGN
    MARKETING
    SALES
    FINANCE
    OPERATIONS
    RECRUITING
    MANAGEMENT
    OTHER
  }

  enum EmailCandidateStatus {
    VERIFIED
    INFERRED_HIGH
    INFERRED_MEDIUM
    INFERRED_LOW
    UNAVAILABLE
    SUPPRESSED
    INVALID
    # Overlaid at read time from the user's suppression list — never stored on
    # a person row. Hard-bounced addresses overlay to INVALID; UNSUBSCRIBED =
    # recipient opted out.
    UNSUBSCRIBED
  }

  enum ConfidenceLevel {
    HIGH
    MEDIUM
    LOW
    UNAVAILABLE
  }

  enum EmailFormatDiscoveryStatus {
    NOT_ATTEMPTED
    FOUND
    NO_EVIDENCE
    NOT_CONFIGURED
    AUTH_ERROR
    RATE_LIMITED
    NETWORK_ERROR
    BAD_PROVIDER_RESPONSE
    PARSER_REJECTED_RESPONSE
  }

  enum ProspectSelectionMode {
    EXPLICIT
    ALL_MATCHING
  }

  type EmailPatternEvidence {
    pattern: String!
    emailDomain: String
    sourceUrl: String
    sourceName: String!
    sourceType: String!
    percentage: Float
    confidence: ConfidenceLevel!
    observedAt: DateTime
  }

  type EmailDomainEvidence {
    emailDomain: String!
    sourceUrl: String
    sourceName: String!
    sourceType: String!
    observedPattern: String
    percentage: Float
    confidence: ConfidenceLevel!
    observedAt: DateTime
  }

  # Read-only aggregate for the Discover detail dashboard: how many of this
  # company's people sit in each email-candidate status. People paginate 10 per
  # page, so the whole-company quality summary needs this server-side count.
  type CompanyEmailStatusCount {
    status: EmailCandidateStatus!
    count: Int!
  }

  type Company {
    id: ID!
    name: String!
    normalizedName: String!
    officialDomain: String
    officialWebsiteDomain: String
    officialWebsite: String
    linkedinUrl: String
    domainConfidence: ConfidenceLevel!
    emailDomain: String
    emailDomainConfidence: ConfidenceLevel!
    emailDomainEvidence: [EmailDomainEvidence!]!
    emailPattern: String
    patternConfidence: ConfidenceLevel!
    patternEvidence: [EmailPatternEvidence!]!
    emailFormatReason: String
    emailFormatDiscoveredAt: DateTime
    emailFormatDiscoveryStatus: EmailFormatDiscoveryStatus!
    emailFormatDiscoveryReason: String
    emailFormatDiscoveryAt: DateTime
    positions: [CompanyPosition!]!
    peopleCount: Int!
    emailStatusCounts: [CompanyEmailStatusCount!]!
    # The authenticated user's OWN searches for this company (newest first).
    # Powers the grouped company detail (role chips + role-targeted Add 10 more)
    # without merging the underlying search records.
    searches: [ProspectSearch!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type CompanyPosition {
    id: ID!
    company: Company!
    category: PositionCategory!
    displayName: String!
    rawTitles: [String!]!
    people: [ProspectPerson!]!
    peopleCount: Int!
  }

  type ProspectPerson {
    id: ID!
    company: Company!
    position: CompanyPosition!
    firstName: String!
    lastName: String!
    fullName: String!
    currentTitle: String
    normalizedTitle: String
    location: String
    country: String
    state: String
    city: String
    linkedinUrl: String!
    inferredEmail: String
    emailStatus: EmailCandidateStatus!
    emailConfidence: ConfidenceLevel!
    emailPattern: String
    emailSource: String
    createdAt: DateTime!
  }

  type ProspectSearch {
    id: ID!
    company: Company
    requestedCompany: String!
    requestedTitles: [String!]!
    requestedLocations: [String!]!
    maxResults: Int!
    status: ProspectSearchStatus!
    # Failure surface is ALWAYS sanitized: errorCode is a safe product category
    # (e.g. COMPANY_NOT_FOUND, TRY_AGAIN_LATER) — never a raw internal code — and
    # errorTitle/errorMessage are safe copy. The raw internal cause stays in
    # server logs / admin tooling only.
    errorCode: String
    errorTitle: String
    errorMessage: String
    retryable: Boolean!
    peopleCount: Int!
    # True when no more unique people can be added to this search (the shared
    # results are exhausted). Drives whether "Add 10 more" is offered.
    exhausted: Boolean!
    # Distinct role-group categories among the people ALLOCATED to this search.
    # Lets the grouped company detail target "Add 10 more" at the child search
    # that owns the active role tab.
    positionCategories: [PositionCategory!]!
    createdAt: DateTime!
    completedAt: DateTime
  }

  # One consolidated Search History entry: all of the authenticated user's
  # searches for the same resolved company, grouped for display only. The child
  # ProspectSearch records (and their usage events, allocations, and Add-More
  # history) are never merged. peopleCount is the UNIQUE union of people
  # allocated to this user across the group's searches — never the shared
  # cross-user cache pool size.
  type DiscoverCompanyGroup {
    id: ID!
    company: Company
    displayName: String!
    requestedRoles: [String!]!
    locations: [String!]!
    searches: [ProspectSearch!]!
    peopleCount: Int!
    latestActivityAt: DateTime!
  }

  type DiscoverCompanyGroupEdge {
    node: DiscoverCompanyGroup!
    cursor: String!
  }

  type DiscoverCompanyGroupConnection {
    edges: [DiscoverCompanyGroupEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  enum DiscoverExpansionStatus {
    PENDING
    PROCESSING
    READY
    FAILED
  }

  # The outcome of one "Add 10 more" request against a READY search. Carries only
  # safe counters and a user-ready message — never people, emails, or internals.
  type DiscoverSearchExpansion {
    id: ID!
    searchId: ID!
    status: DiscoverExpansionStatus!
    requestedCount: Int!
    addedCount: Int!
    totalPeopleCount: Int!
    quotaRemaining: Int!
    exhausted: Boolean!
    message: String
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type ProspectSearchEdge {
    node: ProspectSearch!
    cursor: String!
  }

  type ProspectSearchConnection {
    edges: [ProspectSearchEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type CompanyEdge {
    node: Company!
    cursor: String!
  }

  type CompanyConnection {
    edges: [CompanyEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type ProspectPersonEdge {
    node: ProspectPerson!
    cursor: String!
  }

  type ProspectPersonConnection {
    edges: [ProspectPersonEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input CreateProspectSearchInput {
    companyName: String!
    companyDomain: String
    companyLinkedinUrl: String
    jobTitles: [String!]!
    locations: [String!]
    maxResults: Int = 25
  }

  input ProspectSelectionInput {
    companyId: ID!
    mode: ProspectSelectionMode!
    selectedIds: [ID!]
    excludedIds: [ID!]
    positionCategory: PositionCategory
  }

  type ProspectSelectionReview {
    selectedCount: Int!
    exportableCount: Int!
    unavailableEmailCount: Int!
    suppressedCount: Int!
    duplicateEmailCount: Int!
  }

  type ProspectExport {
    id: ID!
    fileName: String!
    downloadUrl: String!
    review: ProspectSelectionReview!
  }

  type ProspectImportResult {
    importId: ID!
    fileName: String!
    rowCount: Int!
    viewUrl: String!
    review: ProspectSelectionReview!
  }

  type DiscoverQuota {
    resultsPerSearch: Int!
    dailySearchLimit: Int!
    searchesUsed: Int!
    searchesRemaining: Int!
    resetAt: DateTime!
    unlimited: Boolean!
  }

  type Query {
    discoverQuota: DiscoverQuota!
    prospectSearch(id: ID!): ProspectSearch
    prospectSearches(first: Int = 20, after: String): ProspectSearchConnection!
    # Grouped Search History: one entry per resolved company for the current
    # user (unresolved searches stay single-entry). Pagination counts GROUPS.
    discoverCompanyGroups(first: Int = 20, after: String): DiscoverCompanyGroupConnection!

    company(id: ID!): Company
    companies(first: Int = 20, after: String): CompanyConnection!

    people(
      companyId: ID!
      positionCategory: PositionCategory
      first: Int = 50
      after: String
    ): ProspectPersonConnection!
  }

  type Mutation {
    createProspectSearch(input: CreateProspectSearchInput!): ProspectSearch!
    # idempotencyKey is client-generated: a fresh key per deliberate Retry is a new
    # processing attempt, while a network/browser replay of the same key reuses the
    # current attempt (so it never double-processes or double-charges quota).
    processProspectSearch(id: ID!, idempotencyKey: String): ProspectSearch!
    cancelProspectSearch(id: ID!): ProspectSearch!
    # Delete a single Search History entry the user owns (ownership enforced
    # server-side). Removes only that ProspectSearch row, not the company/people.
    deleteProspectSearch(id: ID!): Boolean!
    # Add up to 10 more unique people to an existing READY search. idempotencyKey
    # is client-generated so retries/double-clicks never charge a second slot or
    # add a second batch.
    addMoreDiscoverPeople(searchId: ID!, idempotencyKey: String!): DiscoverSearchExpansion!
    reclassifyCompanyPositions(companyId: ID!): Company!
    reinferCompanyEmailPattern(companyId: ID!): Company!
    refreshCompanyEmailFormat(companyId: ID!, sourceUrl: String): Company!
    discoverCompanyEmailFormat(companyId: ID!, force: Boolean): Company!
    deleteCompany(companyId: ID!): Boolean!
    setCompanyEmailInferenceOverride(
      companyId: ID!
      emailDomain: String!
      emailPattern: String!
      confidence: ConfidenceLevel!
      reason: String
    ): Company!
    reviewProspectSelection(input: ProspectSelectionInput!): ProspectSelectionReview!
    prepareProspectExport(input: ProspectSelectionInput!): ProspectExport!
    createProspectImport(input: ProspectSelectionInput!): ProspectImportResult!
  }
`;
