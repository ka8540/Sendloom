const ENTITY_ID_PATTERN = "[A-Za-z0-9_-]+";

const SAFE_NOTIFICATION_HREFS = [
  new RegExp(`^/prospects/${ENTITY_ID_PATTERN}$`),
  new RegExp(`^/campaigns/${ENTITY_ID_PATTERN}$`),
  /^\/account$/
];

export function isSafeInternalNotificationHref(href: string): boolean {
  return SAFE_NOTIFICATION_HREFS.some((pattern) => pattern.test(href));
}

function safeEntityId(entityId: string): string {
  if (!new RegExp(`^${ENTITY_ID_PATTERN}$`).test(entityId)) {
    throw new Error("Notification destination has an invalid entity id.");
  }
  return entityId;
}

export function discoverNotificationHref(searchId: string): string {
  return `/prospects/${safeEntityId(searchId)}`;
}

export function sequenceNotificationHref(campaignId: string): string {
  return `/campaigns/${safeEntityId(campaignId)}`;
}

export const GMAIL_NOTIFICATION_HREF = "/account";
