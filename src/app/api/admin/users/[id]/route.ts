import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { AdminActionError, deleteUserAccountData, restrictUserAccount, unrestrictUserAccount, updateUserAdminControls } from "@/services/admin";

const updateSchema = z.object({
  apiAccessDisabled: z.boolean(),
  importsWriteDisabled: z.boolean(),
  templatesWriteDisabled: z.boolean(),
  launchesDisabled: z.boolean(),
  aiEnhancementsDisabled: z.boolean(),
  revokeSession: z.boolean().optional()
});

const restrictSchema = z.object({
  action: z.literal("restrict"),
  reason: z.string().min(1).max(500)
});

const unrestrictSchema = z.object({
  action: z.literal("unrestrict")
});

function createAdminErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: "Invalid admin request payload."
      },
      { status: 400 }
    );
  }

  if (error instanceof AdminActionError) {
    return NextResponse.json(
      {
        error: error.message
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: "An unexpected admin action failed."
    },
    { status: 500 }
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminApiUser();
    if ("response" in auth) {
      return auth.response;
    }

    const limit = await rateLimit({ key: `admin:users:update:${auth.user.id}`, limit: 30, windowSeconds: 60 });
    if (!limit.allowed) {
      return createRateLimitResponse(limit.retryAfterSeconds);
    }

    const body = await request.json();
    const { id } = await context.params;

    // Handle restrict action
    if (body.action === "restrict") {
      const payload = restrictSchema.parse(body);
      const result = await restrictUserAccount({
        actorEmail: auth.user.email,
        actorUserId: auth.user.id,
        userId: id,
        reason: payload.reason
      });
      return NextResponse.json(result);
    }

    // Handle unrestrict action
    if (body.action === "unrestrict") {
      unrestrictSchema.parse(body);
      const result = await unrestrictUserAccount({
        actorEmail: auth.user.email,
        actorUserId: auth.user.id,
        userId: id
      });
      return NextResponse.json(result);
    }

    // Default: update controls
    const payload = updateSchema.parse(body);
    const updatedUser = await updateUserAdminControls({
      actorEmail: auth.user.email,
      actorUserId: auth.user.id,
      userId: id,
      ...payload
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    return createAdminErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminApiUser();
    if ("response" in auth) {
      return auth.response;
    }

    const limit = await rateLimit({ key: `admin:users:delete:${auth.user.id}`, limit: 10, windowSeconds: 60 });
    if (!limit.allowed) {
      return createRateLimitResponse(limit.retryAfterSeconds);
    }

    const { id } = await context.params;
    const result = await deleteUserAccountData({
      actorEmail: auth.user.email,
      actorUserId: auth.user.id,
      userId: id
    });

    return NextResponse.json(result);
  } catch (error) {
    return createAdminErrorResponse(error);
  }
}
