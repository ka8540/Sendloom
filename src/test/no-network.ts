import { beforeEach, afterEach, vi } from "vitest";

// Tests opt into their own mock responses. An overlooked API call must never
// leave the machine (in particular while testing provider/name repair pages).
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unmocked network request in test"); }));
});
afterEach(() => vi.unstubAllGlobals());
