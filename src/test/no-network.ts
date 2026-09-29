import { beforeEach, afterEach, vi } from "vitest";

// Vitest executes server services outside Next's react-server module condition.
vi.mock("server-only", () => ({}));

// Tests opt into their own mock responses. An overlooked API call must never
// leave the machine (in particular while testing provider/name repair pages).
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unmocked network request in test"); }));
});
afterEach(() => vi.unstubAllGlobals());
