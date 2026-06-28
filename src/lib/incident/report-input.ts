// Strict zod schemas for UNTRUSTED client-submitted incident context. The client
// may only send safe, bounded fields: strict() rejects any unknown key (so a
// client can never inject severity, status, the reporter pseudonym, occurrence
// count, or a public id — those are all derived/owned server-side), and every
// field is length/range capped. featureFlags is a flat record of booleans, so
// object depth + value types are bounded too.

import { z } from "zod";

export const errorContextSchema = z
  .object({
    category: z.string().max(40).optional(),
    feature: z.string().max(120).optional(),
    operation: z.string().max(120).optional(),
    route: z.string().max(256).optional(),
    requestMethod: z.string().max(10).optional(),
    internalCode: z.string().max(80).optional(),
    httpStatus: z.coerce.number().int().min(100).max(599).optional(),
    correlationId: z.string().max(80).optional(),
    appVersion: z.string().max(40).optional(),
    browserFamily: z.string().max(60).optional(),
    platform: z.string().max(60).optional(),
    onlineStatus: z.boolean().optional(),
    retryable: z.boolean().optional(),
    retryCount: z.coerce.number().int().min(0).max(50).optional(),
    gmailConnected: z.boolean().optional(),
    sequenceState: z.string().max(24).optional(),
    currentOperationState: z.string().max(48).optional(),
    featureFlags: z.record(z.string().max(40), z.boolean()).optional()
  })
  .strict();

export const createReportSchema = errorContextSchema
  .extend({
    userNote: z.string().max(1000).optional(),
    eventId: z.string().max(40).optional(),
    idempotencyKey: z.string().max(80).optional()
  })
  .strict();

export type ErrorContextPayload = z.infer<typeof errorContextSchema>;
export type CreateReportPayload = z.infer<typeof createReportSchema>;
