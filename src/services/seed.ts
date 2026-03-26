import { prisma } from "@/lib/db";
import { createPasswordHash, normalizeUserEmail } from "@/lib/auth";
import { env } from "@/lib/env";

export async function ensureBootstrapData() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return;
  }

  const email = normalizeUserEmail(env.ADMIN_EMAIL);
  const passwordHash = await createPasswordHash(env.ADMIN_PASSWORD);

  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash
    },
    create: {
      email,
      passwordHash
    }
  });
}
