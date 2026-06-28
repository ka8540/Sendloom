// Non-sequential public identifiers for incident events + reports. Random (not a
// counter) so the total volume of reports is never inferable from an id, and
// Crockford base32 (no I/L/O/U) so codes are unambiguous when read aloud or typed
// by a user quoting "Reference: INC-7F2A9C".

import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

function randomCode(length = CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CROCKFORD[bytes[i] % CROCKFORD.length];
  }
  return out;
}

/** e.g. `INC-7F2A9C` — shown to the reporter and the admin. */
export function newPublicReportId(): string {
  return `INC-${randomCode()}`;
}

/** e.g. `EVT-7F2A9C` — internal/diagnostic, links a report to its error event. */
export function newPublicEventId(): string {
  return `EVT-${randomCode()}`;
}
