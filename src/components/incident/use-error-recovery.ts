"use client";

import { useCallback, useRef, useState } from "react";

import type { NormalizedAppError } from "@/lib/incident/app-error";
import {
  type ClientErrorContext,
  normalizeResponseError,
  normalizeThrownError,
  toReportContext
} from "@/lib/incident/normalize-client-error";

import { detectBrowserFamily, detectPlatform, readCsrfToken } from "./client-diagnostics";

/**
 * Hook that normalizes a failure into a NormalizedAppError, holds it for the
 * recovery panel, and auto-captures a sanitized error EVENT exactly once per
 * unique failure (so re-renders never re-capture, and a report is never created
 * automatically — only the user's explicit Report does that). Returns helpers to
 * fail from a thrown error or a non-ok Response, plus clear() for a successful
 * retry.
 */
export function useErrorRecovery(context: ClientErrorContext = {}) {
  const [error, setError] = useState<NormalizedAppError | null>(null);
  const capturedKeys = useRef<Set<string>>(new Set());
  const contextRef = useRef(context);
  contextRef.current = context;

  const captureOnce = useCallback((normalized: NormalizedAppError) => {
    if (!normalized.reportable) {
      return;
    }
    const key = `${normalized.category}:${normalized.feature}:${normalized.operation}:${normalized.correlationId ?? ""}`;
    if (capturedKeys.current.has(key)) {
      return;
    }
    capturedKeys.current.add(key);

    try {
      const csrf = readCsrfToken();
      // Fire-and-forget; auto-capture must never throw into the UI. keepalive so
      // it still flushes if the user navigates right after the failure.
      void fetch("/api/incidents/events", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {})
        },
        body: JSON.stringify(
          toReportContext(normalized, {
            browserFamily: detectBrowserFamily(),
            platform: detectPlatform()
          })
        )
      }).catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  const fail = useCallback(
    (normalized: NormalizedAppError) => {
      setError(normalized);
      captureOnce(normalized);
      return normalized;
    },
    [captureOnce]
  );

  const failFromThrown = useCallback(
    (thrown: unknown) => fail(normalizeThrownError(thrown, contextRef.current)),
    [fail]
  );

  const failFromResponse = useCallback(
    (response: { status: number; headers?: { get(name: string): string | null } }, body?: unknown) => {
      const normalized = normalizeResponseError(response, contextRef.current, body);
      if (normalized) {
        fail(normalized);
      }
      return normalized;
    },
    [fail]
  );

  const clear = useCallback(() => setError(null), []);

  return { error, fail, failFromThrown, failFromResponse, clear, setError };
}
