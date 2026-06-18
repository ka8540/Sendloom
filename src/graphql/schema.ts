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
  }

  enum ConfidenceLevel {
    HIGH
    MEDIUM
    LOW
    UNAVAILABLE
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
    positions: [CompanyPosition!]!
    peopleCount: Int!
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
    errorCode: String
    errorMessage: String
    peopleCount: Int!
    createdAt: DateTime!
    completedAt: DateTime
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

  type Query {
    prospectSearch(id: ID!): ProspectSearch
    prospectSearches(first: Int = 20, after: String): ProspectSearchConnection!

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
    processProspectSearch(id: ID!): ProspectSearch!
    cancelProspectSearch(id: ID!): ProspectSearch!
    reclassifyCompanyPositions(companyId: ID!): Company!
    reinferCompanyEmailPattern(companyId: ID!): Company!
    refreshCompanyEmailFormat(companyId: ID!, sourceUrl: String): Company!
    deleteCompany(companyId: ID!): Boolean!
    setCompanyEmailInferenceOverride(
      companyId: ID!
      emailDomain: String!
      emailPattern: String!
      confidence: ConfidenceLevel!
      reason: String
    ): Company!
  }
`;
