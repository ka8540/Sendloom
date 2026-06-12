import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { SESSION_ERROR_MESSAGE, getSessionUser, isAdminUser } from "@/lib/auth";

export function createUnauthorizedApiResponse(message = SESSION_ERROR_MESSAGE) {
  return NextResponse.json(
    {
      error: message
    },
    { status: 401 }
  );
}

export function createForbiddenApiResponse(message = "You do not have access to this action.") {
  return NextResponse.json(
    {
      error: message
    },
    { status: 403 }
  );
}

export type ApiCapability = "importsWrite" | "templatesWrite" | "campaignLaunch" | "aiEnhance";

export function getApiRestrictionMessage(
  user: {
    apiAccessDisabled?: boolean | null;
    importsWriteDisabled?: boolean | null;
    templatesWriteDisabled?: boolean | null;
    launchesDisabled?: boolean | null;
    aiEnhancementsDisabled?: boolean | null;
  },
  capability?: ApiCapability
) {
  if (user.apiAccessDisabled) {
    return "API access is disabled for this account.";
  }

  if (capability === "importsWrite" && user.importsWriteDisabled) {
    return "Import changes are disabled for this account.";
  }

  if (capability === "templatesWrite" && user.templatesWriteDisabled) {
    return "Template changes are disabled for this account.";
  }

  if (capability === "campaignLaunch" && user.launchesDisabled) {
    return "Campaign launches are disabled for this account.";
  }

  if (capability === "aiEnhance" && user.aiEnhancementsDisabled) {
    return "AI enhancements are disabled for this account.";
  }

  return null;
}

export function getVerificationBlockMessage(
  user: {
    adultVerifiedAt?: Date | null;
    termsAcceptedAt?: Date | null;
    privacyAcceptedAt?: Date | null;
    antiAbuseAcceptedAt?: Date | null;
    eligibilityBlockedAt?: Date | null;
    restrictedAt?: Date | null;
    restrictedReason?: string | null;
  }
) {
  if (user.eligibilityBlockedAt) {
    return "Sendloom is not available to users under 18.";
  }

  if (user.restrictedAt) {
    return user.restrictedReason
      ? `Your account has been restricted: ${user.restrictedReason}`
      : "Your account has been restricted. Contact support for assistance.";
  }

  if (!user.adultVerifiedAt || !user.termsAcceptedAt || !user.privacyAcceptedAt || !user.antiAbuseAcceptedAt) {
    return "Your account must complete eligibility and policy confirmation before using Sendloom.";
  }

  return null;
}

export async function requireApiUser(capability?: ApiCapability) {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: createUnauthorizedApiResponse()
    } as const;
  }

  const restrictionMessage = getApiRestrictionMessage(user, capability);
  if (restrictionMessage) {
    return {
      response: createForbiddenApiResponse(restrictionMessage)
    } as const;
  }

  const verificationMessage = getVerificationBlockMessage(user);
  if (verificationMessage) {
    return {
      response: createForbiddenApiResponse(verificationMessage)
    } as const;
  }

  return {
    user
  } as const;
}

export async function requireAdminApiUser(request?: Request) {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: createUnauthorizedApiResponse()
    } as const;
  }

  if (!isAdminUser(user)) {
    await recordAuditEvent({
      actor: { id: user.id, email: user.email },
      action: "security.admin_access_denied",
      category: "SECURITY",
      severity: "SECURITY",
      message: "Blocked a non-admin request to an admin API.",
      request
    });

    return {
      response: createForbiddenApiResponse("Admin access is required.")
    } as const;
  }

  return {
    user
  } as const;
}
