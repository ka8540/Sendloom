import { NextResponse } from "next/server";

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

  return {
    user
  } as const;
}

export async function requireAdminApiUser() {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: createUnauthorizedApiResponse()
    } as const;
  }

  if (!isAdminUser(user)) {
    return {
      response: createForbiddenApiResponse("Admin access is required.")
    } as const;
  }

  return {
    user
  } as const;
}
