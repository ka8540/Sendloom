import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export async function writeAuditLog(args: {
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      actorEmail: args.actorEmail,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      metadata: args.metadata as Prisma.InputJsonValue | undefined
    }
  });
}
