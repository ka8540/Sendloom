import { describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ scan: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));
vi.mock("@/services/imports", () => ({ createImport: vi.fn() }));
import { deletePreparedProspectExportsForUser } from "./prospect-export";

describe("prepared Discover export cleanup", () => {
  it("deletes only the departing user's export payloads", async () => {
    redis.scan.mockResolvedValue(["0", ["prospect-export:a", "prospect-export:b", "prospect-export:c"]]);
    redis.get.mockImplementation(async (key: string) => key.endsWith(":a") ? JSON.stringify({ userId: "user-a", rows: [{ email: "private@example.com" }] }) : key.endsWith(":b") ? JSON.stringify({ userId: "user-b", rows: [] }) : null);
    await deletePreparedProspectExportsForUser("user-a");
    expect(redis.del).toHaveBeenCalledExactlyOnceWith("prospect-export:a");
  });
});
