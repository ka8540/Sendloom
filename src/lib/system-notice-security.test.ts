import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("system notice security boundaries", () => {
  it("requires DB-backed admin authorization on every management route", () => {
    const routes = [
      "src/app/api/admin/system-notices/route.ts",
      "src/app/api/admin/system-notices/preview/route.ts",
      "src/app/api/admin/system-notices/[id]/route.ts",
      "src/app/api/admin/system-notices/[id]/schedule/route.ts",
      "src/app/api/admin/system-notices/[id]/send-now/route.ts",
      "src/app/api/admin/system-notices/[id]/cancel/route.ts"
    ];
    for (const route of routes) {
      const source = read(route);
      expect(source).toContain("requireAdminApiUser(request)");
      expect(source).not.toContain("ADMIN_EMAIL");
    }
  });

  it("keeps preview pure and targeting server-selected from User records", () => {
    const preview = read("src/app/api/admin/system-notices/preview/route.ts");
    expect(preview).toContain("renderSystemNoticeEmail");
    expect(preview).not.toContain("resendSystemNoticeMailer");
    expect(preview).not.toContain("systemNoticeRecipient");

    const processor = read("src/lib/system-notice-notifications.ts");
    expect(processor).toContain("select: { id: true, email: true }");
    expect(processor).toContain("SYSTEM_NOTICE_PROCESSING_ENABLED");
    expect(processor).toContain('nodeEnv === "production"');
    expect(processor).toContain('vercelEnv === "production"');
    expect(processor).not.toContain("senderProfile.findMany");
    expect(processor).not.toContain("recipientEmails");
  });

  it("has database uniqueness, leases, immutable delivery states, and a stable idempotency namespace", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("@@unique([noticeId, userId])");
    expect(schema).toContain("leaseToken");
    expect(schema).toContain("leaseExpiresAt");

    const processor = read("src/lib/system-notice-notifications.ts");
    expect(processor).toContain("FOR UPDATE OF recipient SKIP LOCKED");
    expect(processor).toContain("system-notice-${notice.id}-${recipient.id}");

    const service = read("src/services/system-notices.ts");
    expect(service).toContain("startedAt: null");
    expect(service).toContain("This notice is immutable because delivery has started.");
    expect(service).toContain("SystemNoticeStatus.CANCELLED");
  });
});
