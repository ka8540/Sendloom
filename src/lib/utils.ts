export function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, "_").toLowerCase();
}

export function isValidEmail(email?: string | null) {
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
