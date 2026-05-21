export const CSRF_COOKIE = "sendloom_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const CSRF_TOKEN_BYTES = 32;
export const CSRF_TOKEN_HEX_LENGTH = CSRF_TOKEN_BYTES * 2;
export const CSRF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function generateCsrfToken() {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function isValidCsrfToken(value: string | undefined | null) {
  return typeof value === "string" && /^[a-f0-9]+$/i.test(value) && value.length === CSRF_TOKEN_HEX_LENGTH;
}

export function csrfTokensMatch(cookie: string | undefined | null, header: string | undefined | null) {
  if (!isValidCsrfToken(cookie) || !isValidCsrfToken(header)) {
    return false;
  }

  const a = (cookie as string).toLowerCase();
  const b = (header as string).toLowerCase();

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
