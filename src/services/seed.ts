import { prisma } from "@/lib/db";
import { createPasswordHash } from "@/lib/auth";
import { env } from "@/lib/env";

export async function ensureBootstrapData() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return;
  }

  const passwordHash = await createPasswordHash(env.ADMIN_PASSWORD);

  await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: {
      passwordHash
    },
    create: {
      email: env.ADMIN_EMAIL,
      passwordHash
    }
  });
}
