import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCampaign: vi.fn(),
  findTemplate: vi.fn(),
  getApiRestrictionMessage: vi.fn(),
  requireApiUser: vi.fn(),
  updateCampaignFollowUpSettings: vi.fn(),
  updateCampaignSchedule: vi.fn(),
  updateCampaignSetup: vi.fn(),
  writeAuditLog: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({
  createForbiddenApiResponse: (message: string) => Response.json({ error: message }, { status: 403 }),
  getApiRestrictionMessage: mocks.getApiRestrictionMessage,
  requireApiUser: mocks.requireApiUser
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mocks.writeAuditLog
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn()
    },
    template: {
      findFirst: mocks.findTemplate
    }
  }
}));

vi.mock("@/lib/storage", () => ({
  storeUpload: vi.fn()
}));

vi.mock("@/services/campaigns", () => ({
  deleteCampaign: mocks.deleteCampaign,
  updateCampaignFollowUpSettings: mocks.updateCampaignFollowUpSettings,
  updateCampaignSchedule: mocks.updateCampaignSchedule,
  updateCampaignSetup: mocks.updateCampaignSetup
}));

import { PATCH } from "./route";

function createFollowUpRequest(fields: Record<string, string>) {
  const formData = new FormData();
  formData.set("followUpSettings", "true");

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return new Request("http://localhost/api/campaigns/campaign-id", {
    method: "PATCH",
    body: formData
  });
}

async function patchFollowUp(fields: Record<string, string>) {
  const response = await PATCH(createFollowUpRequest(fields), {
    params: Promise.resolve({ id: "campaign-id" })
  });

  if (!response) {
    throw new Error("PATCH returned no response.");
  }

  return response;
}

describe("PATCH /api/campaigns/[id] follow-up settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiRestrictionMessage.mockReturnValue(null);
    mocks.requireApiUser.mockResolvedValue({
      user: {
        email: "operator@example.com",
        id: "user-id"
      }
    });
    mocks.findTemplate.mockResolvedValue({
      subject: "Checking in"
    });
    mocks.updateCampaignFollowUpSettings.mockResolvedValue({
      id: "campaign-id"
    });
  });

  it("accepts disabling follow-ups", async () => {
    const response = await patchFollowUp({
      followUpEnabled: "false"
    });

    expect(response.status).toBe(200);
    expect(mocks.updateCampaignFollowUpSettings).toHaveBeenCalledWith(
      {
        campaignId: "campaign-id",
        followUp: {
          delayDays: null,
          enabled: false,
          sendMode: null,
          templateId: null
        }
      },
      "user-id"
    );
  });

  it("accepts valid enabled follow-up settings", async () => {
    const response = await patchFollowUp({
      followUpDelayDays: "2",
      followUpEnabled: "true",
      followUpSendMode: "NEW_EMAIL",
      followUpTemplateId: "template-id"
    });

    expect(response.status).toBe(200);
    expect(mocks.findTemplate).toHaveBeenCalledWith({
      where: {
        id: "template-id",
        userId: "user-id"
      },
      select: {
        subject: true
      }
    });
    expect(mocks.updateCampaignFollowUpSettings).toHaveBeenCalledWith(
      {
        campaignId: "campaign-id",
        followUp: {
          delayDays: 2,
          enabled: true,
          sendMode: "NEW_EMAIL",
          templateId: "template-id"
        }
      },
      "user-id"
    );
  });

  it("rejects enabled follow-ups without a template", async () => {
    const response = await patchFollowUp({
      followUpDelayDays: "2",
      followUpEnabled: "true",
      followUpSendMode: "SAME_THREAD"
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Select a follow-up template.");
    expect(mocks.updateCampaignFollowUpSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid follow-up delays", async () => {
    const response = await patchFollowUp({
      followUpDelayDays: "0",
      followUpEnabled: "true",
      followUpSendMode: "SAME_THREAD",
      followUpTemplateId: "template-id"
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Enter a delay of at least 1 day.");
    expect(mocks.updateCampaignFollowUpSettings).not.toHaveBeenCalled();
  });

  it("rejects a follow-up template owned by another user", async () => {
    mocks.findTemplate.mockResolvedValueOnce(null);

    const response = await patchFollowUp({
      followUpDelayDays: "2",
      followUpEnabled: "true",
      followUpSendMode: "SAME_THREAD",
      followUpTemplateId: "template-id"
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Select a follow-up template.");
    expect(mocks.updateCampaignFollowUpSettings).not.toHaveBeenCalled();
  });
});
