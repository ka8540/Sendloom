import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, update: mocks.update },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth", () => ({
  isAdminUser: (user: { isAdmin: boolean }) => user.isAdmin,
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
import {
  restrictUserAccount,
  unrestrictUserAccount,
  updateUserAdminControls,
} from "@/services/admin";
const actor = { actorEmail: "admin@example.com", actorUserId: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
});
describe("admin account safety", () => {
  it.each(["self", "admin"])(
    "blocks %s restriction and control changes before mutation",
    async (kind) => {
      const id = kind === "self" ? "admin-1" : "admin-2";
      mocks.findUnique.mockResolvedValue({
        id,
        email: `${id}@example.com`,
        isAdmin: true,
      });
      await expect(
        restrictUserAccount({ ...actor, userId: id, reason: "Test" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        unrestrictUserAccount({ ...actor, userId: id }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        updateUserAdminControls({
          ...actor,
          userId: id,
          apiAccessDisabled: false,
          importsWriteDisabled: false,
          templatesWriteDisabled: false,
          launchesDisabled: false,
          aiEnhancementsDisabled: false,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
});
