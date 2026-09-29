// Parsing clues only. RoleClassificationService and role-semantic-policy
// authorize roles; this vocabulary must never authorize a candidate.
const ROLE_TITLE_WORDS = /\b(?:engineer(?:ing)?|developer|programmer|architect|recruiter|recruitment|recruiting|talent|sourcer|sourcing|people|human\s+resources?|hr|hrbp|partner|coordinator|generalist|scientist|analyst|designer|manager|director|lead|specialist|consultant|administrator|executive|officer|president|founder|intern|researcher|sales|marketing|product|operations|security|data|software|frontend|backend|full[ -]?stack|devops|sre|accountant|attorney)\b/i;

export function looksLikeRoleTitle(text: string): boolean {
  return ROLE_TITLE_WORDS.test(text);
}
