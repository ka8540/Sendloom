export function isCronRequestAuthorized(headers: Pick<Headers, "get">, cronSecret?: string | null) {
  if (!cronSecret) {
    return true;
  }

  const authHeader = headers.get("authorization");
  const secretHeader = headers.get("x-cron-secret");
  const authSecret = authHeader?.replace(/^Bearer\s+/i, "").trim();

  return authSecret === cronSecret || secretHeader?.trim() === cronSecret;
}
