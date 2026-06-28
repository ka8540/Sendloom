import { describe, expect, it } from "vitest";

import { deriveSeverity } from "@/lib/incident/severity";

describe("deriveSeverity (server-derived only)", () => {
  it("escalates server outages as they recur", () => {
    expect(deriveSeverity("SERVER_ERROR", 1)).toBe("MEDIUM");
    expect(deriveSeverity("SERVER_ERROR", 3)).toBe("HIGH");
    expect(deriveSeverity("SERVER_ERROR", 5)).toBe("CRITICAL");
    expect(deriveSeverity("SERVICE_UNAVAILABLE", 5)).toBe("CRITICAL");
  });

  it("rates persistent Gmail / sequence failures High", () => {
    expect(deriveSeverity("GMAIL_AUTHORIZATION", 1)).toBe("MEDIUM");
    expect(deriveSeverity("GMAIL_AUTHORIZATION", 3)).toBe("HIGH");
    expect(deriveSeverity("SEQUENCE_LAUNCH", 3)).toBe("HIGH");
  });

  it("rates isolated transport failures Medium", () => {
    expect(deriveSeverity("REQUEST_TIMEOUT", 1)).toBe("MEDIUM");
    expect(deriveSeverity("NETWORK_OFFLINE", 1)).toBe("MEDIUM");
  });

  it("rates a single contained client render error Low", () => {
    expect(deriveSeverity("CLIENT_RENDER", 1)).toBe("LOW");
    expect(deriveSeverity("CLIENT_RENDER", 5)).toBe("MEDIUM");
  });
});
