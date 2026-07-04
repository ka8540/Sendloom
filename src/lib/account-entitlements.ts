/**
 * Server-side account exemption helpers shared by product quota systems.
 * Callers must pass the email read from the authenticated User record, never a
 * browser-provided value.
 */

const APPLICATION_OWNER_EMAIL = "kush.ahir2024@gmail.com";

export function normalizeEntitlementEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isApplicationOwner(user: { email?: string | null }): boolean {
  return normalizeEntitlementEmail(user.email) === APPLICATION_OWNER_EMAIL;
}

export function isProductLimitExempt(user: { email?: string | null }): boolean {
  return isApplicationOwner(user);
}
