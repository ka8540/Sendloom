// A small, GENERIC dictionary of canonical role and location labels used as a
// fallback pool for typo correction / casing cleanup when the user's own
// Discover history is sparse. Deliberately company-agnostic — it contains only
// common professional role titles and well-known place names, never a specific
// company, product, or user value. The user's own history always takes
// precedence over these when both are supplied to canonicalizeLabel(s).

export const COMMON_ROLE_LABELS: readonly string[] = [
  "Software Engineer",
  "Senior Software Engineer",
  "Staff Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Mobile Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Data Engineer",
  "Data Scientist",
  "Data Analyst",
  "Machine Learning Engineer",
  "Product Manager",
  "Program Manager",
  "Project Manager",
  "Product Designer",
  "Designer",
  "UX Designer",
  "UI Designer",
  "Engineering Manager",
  "Recruiter",
  "Technical Recruiter",
  "Talent Acquisition",
  "Sales Manager",
  "Account Executive",
  "Account Manager",
  "Marketing Manager",
  "Business Analyst",
  "Solutions Engineer",
  "Customer Success Manager",
  "Operations Manager",
  "Financial Analyst"
];

export const COMMON_LOCATION_LABELS: readonly string[] = [
  "United States",
  "United Kingdom",
  "Canada",
  "India",
  "Germany",
  "France",
  "Australia",
  "Netherlands",
  "Ireland",
  "Singapore",
  "Brazil",
  "Mexico",
  "Spain",
  "Italy",
  "Japan",
  "New York",
  "San Francisco",
  "Los Angeles",
  "London",
  "Bangalore",
  "Toronto",
  "Berlin",
  "Remote"
];
