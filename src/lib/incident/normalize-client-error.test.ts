import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeResponseError, normalizeThrownError } from "@/lib/incident/normalize-client-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeResponseError", () => {
  it("ignores 4xx responses (validation / auth / not-found handled by the caller)", () => {
    expect(normalizeResponseError({ status: 400 })).toBeNull();
    expect(normalizeResponseError({ status: 404 })).toBeNull();
    expect(normalizeResponseError({ status: 409 })).toBeNull();
  });

  it("maps 5xx to an incident and extracts a safe correlation id + code", () => {
    const normalized = normalizeResponseError(
      { status: 503, headers: { get: () => null } },
      { feature: "Imports", operation: "Process import" },
      { requestId: "req_abc123", errorCode: "QUEUE_DOWN" }
    );
    expect(normalized?.category).toBe("SERVICE_UNAVAILABLE");
    expect(normalized?.correlationId).toBe("req_abc123");
    expect(normalized?.internalCode).toBe("QUEUE_DOWN");
    expect(normalized?.feature).toBe("Imports");
  });
});

describe("normalizeThrownError", () => {
  it("classifies offline when the browser reports no connection", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(normalizeThrownError(new Error("network")).category).toBe("NETWORK_OFFLINE");
  });

  it("classifies an abort/timeout", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const aborted = new DOMException("aborted", "AbortError");
    expect(normalizeThrownError(aborted).category).toBe("REQUEST_TIMEOUT");
  });

  it("defaults to a generic network failure", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(normalizeThrownError(new TypeError("Failed to fetch")).category).toBe("NETWORK_REQUEST_FAILED");
  });
});
