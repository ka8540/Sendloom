// Incident status values. Kept in a dependency-free module (no prisma / redis /
// node built-ins) so BOTH the server service and the client admin dashboard can
// import it without pulling server-only code (ioredis, etc.) into the browser
// bundle.

export const INCIDENT_STATUSES = ["NEW", "INVESTIGATING", "RESOLVED", "IGNORED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
