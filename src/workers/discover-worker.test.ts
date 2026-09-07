import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ run: vi.fn(async () => {}), recover: vi.fn(async () => {}),
  processor: null as null | ((job: { data: { fingerprint: string } }) => Promise<void>), close: vi.fn(async () => {}) }));
vi.mock('@/services/prospects/discover-public-pool-job', () => ({ runPublicPoolJob: state.run, enqueuePendingPublicPools: state.recover }));
vi.mock('bullmq', () => ({ Worker: class {
  constructor(_name: string, processor: typeof state.processor) { state.processor = processor; }
  on() { return this; }
  close = state.close;
} }));
import { startDiscoverWorker } from './discover-worker';
import type { PrismaClient } from '@prisma/client';
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
describe('long-lived discovery consumer', () => {
  it('recovers unfinished pools at startup and every minute without HTTP/Add More', async () => {
    const db = {} as PrismaClient; const consumer = startDiscoverWorker(db, {});
    expect(state.recover).toHaveBeenCalledWith(db);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.recover).toHaveBeenCalledTimes(2);
    await state.processor!({ data: { fingerprint: 'pool' } });
    expect(state.run).toHaveBeenCalledWith(db, 'pool');
    await consumer.close(); await vi.advanceTimersByTimeAsync(60_000);
    expect(state.recover).toHaveBeenCalledTimes(2); expect(state.close).toHaveBeenCalledOnce();
  });
  it('does not overlap slow recovery scans', async () => {
    let release!: () => void;
    state.recover.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const consumer = startDiscoverWorker({} as PrismaClient, {});
    await vi.advanceTimersByTimeAsync(180_000); expect(state.recover).toHaveBeenCalledOnce();
    release(); await consumer.close();
  });
  it('keeps recovering after a failure, without logging the error payload', async () => {
    state.recover.mockRejectedValueOnce(new Error('private URL and credential'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consumer = startDiscoverWorker({} as PrismaClient, {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.recover).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    await consumer.close(); warn.mockRestore();
  });
});
