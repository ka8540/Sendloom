import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { pendingPublicPoolWhere, publicExpansionEnabled, runPublicPoolStep } from '@/services/prospects/discover-public-pool-job';

export const runtime = 'nodejs';
// Allows the existing validation calls to settle after the provider deadline.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function handleCron(request: Request) {
  // Same header conventions as campaigns; fail closed in every environment.
  if (!env.CRON_SECRET || !(request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`
    || request.headers.get('x-cron-secret') === env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const result = { ok: true, processedCaches: 0, pagesProcessed: 0, peopleInserted: 0, remainingWork: false };
  try {
    if (publicExpansionEnabled()) {
      const pending = await prisma.discoverSearchCache.findMany({ where: pendingPublicPoolWhere(),
        orderBy: [{ lastProviderFetchAt: 'asc' }, { id: 'asc' }], take: 1, select: { fingerprint: true } });
      for (const entry of pending) {
        const step = await runPublicPoolStep(prisma, entry.fingerprint, undefined,
          { signal: AbortSignal.timeout(45_000), logPrefix: '[discover-expansion-cron]' });
        result.pagesProcessed += step.pagesProcessed;
        result.peopleInserted += step.peopleInserted;
        result.processedCaches += Number(step.pagesProcessed > 0);
      }
      result.remainingWork = (await prisma.discoverSearchCache.findMany({ where: pendingPublicPoolWhere(),
        take: 1, select: { id: true } })).length > 0;
    }
    if (!result.remainingWork && !result.pagesProcessed)
      console.info('[discover-expansion-cron]', { event: 'NO_PENDING_WORK' });
    return NextResponse.json(result);
  } catch {
    console.error('[discover-expansion-cron]', { event: 'ERROR' });
    return NextResponse.json({ ...result, ok: false, remainingWork: true }, { status: 500 });
  }
}

export const GET = handleCron;
export const POST = handleCron;
