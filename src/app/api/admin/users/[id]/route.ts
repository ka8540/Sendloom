import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { AdminActionError, deleteUserAccountData, updateUserAdminControls } from "@/services/admin";

const updateSchema = z.object({
  apiAccessDisabled: z.boolean(),
  importsWriteDisabled: z.boolean(),
  templatesWriteDisabled: z.boolean(),
  launchesDisabled: z.boolean(),
  aiEnhancementsDisabled: z.boolean(),
  revokeSession: z.boolean().optional()
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

    const payload = updateSchema.parse(await request.json());
    const { id } = await context.params;
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
