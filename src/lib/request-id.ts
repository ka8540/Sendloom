// Smallest-safe request correlation id. Lets an admin connect a user's incident
// report to backend logs without exposing the user. Carries NO user information —
// it is just random. The GraphQL layer already mints a per-request UUID
// (src/graphql/context.ts); REST error paths use this so the safe id can be
// returned to the client and attached to the error event/report.

import { randomUUID } from "node:crypto";

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "")}`;
}
