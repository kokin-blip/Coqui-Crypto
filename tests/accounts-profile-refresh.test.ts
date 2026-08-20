import { describe, expect, it, vi } from 'vitest';

import {
  AccountsProfileRefreshService,
  createProfileOperationGate,
  type ProfileRefreshExecutor,
  type ProfileRefreshExecutorResult,
} from '../packages/services/src/index.js';
import type {
  ProfileManifestStore,
  StoredProfileRecord,
} from '../packages/storage/src/index.js';

function record(index: number): StoredProfileRecord {
  const id = index === 0
    ? 'main'
    : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    name: `Profile ${index}`,
    color: '#60a5fa',
    icon: 'wallet',
    dbFilename: index === 0 ? 'kokintrader.db' : `wallet-${id}.db`,
    createdAt: 1,
    lastOpenedAt: 1,
    order: index,
    ...(index % 2 === 0 ? { coinbaseKeyFingerprint: 'a'.repeat(64) } : {}),
  };
}

function store(records: readonly StoredProfileRecord[], activeProfileId = records[0]!.id): ProfileManifestStore {
  return {
    read: () => ({
      ok: true,
      value: {
        revision: 'b'.repeat(64),
        manifest: { version: 1, activeProfileId, profiles: records },
      },
    }),
    replace: () => ({ ok: false, code: 'invalid_manifest' }),
  };
}

describe('accounts multi-profile refresh', () => {
  it('preserves manifest order and contains malformed or thrown profile failures', async () => {
    const records = Array.from({ length: 6 }, (_, index) => record(index));
    const executor: ProfileRefreshExecutor = {
      refresh: vi.fn(async (
        request,
      ): Promise<ProfileRefreshExecutorResult> => {
        expect(Object.isFrozen(request)).toBe(true);
        const { profileId, databaseFilename, configurationHint, requestedAtMs } = request;
        expect(databaseFilename).toMatch(/\.db$/u);
        expect(requestedAtMs).toBe(100);
        const index = records.findIndex((item) => item.id === profileId);
        expect(configurationHint).toBe(index % 2 === 0 ? 'configured' : 'not_configured');
        if (index === 0) return {
          status: 'refreshed', evidenceCount: 2, secret: 'do-not-copy',
        } as never;
        if (index === 1) return { status: 'skipped', reasonCode: 'not_configured' };
        if (index === 2) return { status: 'failed', reasonCode: 'provider_unavailable' };
        if (index === 3) throw new Error('secret provider diagnostic');
        if (index === 4) return { status: 'refreshed', evidenceCount: -1 };
        return { status: 'cancelled', reasonCode: 'shutdown' };
      }),
    };
    const clock = { nowMs: vi.fn(() => 100) };
    const service = new AccountsProfileRefreshService({
      clock, manifestStore: store(records, records[2]!.id), executor,
    });

    const result = await service.refreshAll();

    expect(result).toEqual({
      ok: true,
      value: {
        requestedAtMs: 100,
        status: 'partial',
        profileCount: 6,
        refreshedCount: 1,
        skippedCount: 1,
        failedCount: 3,
        cancelledCount: 1,
        evidenceCount: 2,
        outcomes: [
          { profileId: 'main', profileName: 'Profile 0', isActive: false, status: 'refreshed', evidenceCount: 2 },
          { profileId: records[1]!.id, profileName: 'Profile 1', isActive: false, status: 'skipped', reasonCode: 'not_configured' },
          { profileId: records[2]!.id, profileName: 'Profile 2', isActive: true, status: 'failed', reasonCode: 'provider_unavailable' },
          { profileId: records[3]!.id, profileName: 'Profile 3', isActive: false, status: 'failed', reasonCode: 'unexpected_failure' },
          { profileId: records[4]!.id, profileName: 'Profile 4', isActive: false, status: 'failed', reasonCode: 'invalid_response' },
          { profileId: records[5]!.id, profileName: 'Profile 5', isActive: false, status: 'cancelled', reasonCode: 'shutdown' },
        ],
      },
    });
    expect(clock.nowMs).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('do-not-copy');
    expect(serialized).not.toContain('secret provider diagnostic');
    expect(serialized).not.toContain('wallet-');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.outcomes)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.outcomes[0])).toBe(true);
  });

  it('caps profile refresh concurrency at four', async () => {
    const records = Array.from({ length: 9 }, (_, index) => record(index));
    let active = 0;
    let peak = 0;
    const executor: ProfileRefreshExecutor = {
      async refresh() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { status: 'refreshed', evidenceCount: 1 };
      },
    };
    const service = new AccountsProfileRefreshService({
      clock: { nowMs: () => 10 }, manifestStore: store(records), executor,
    });

    expect(await service.refreshAll()).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'complete', profileCount: 9, refreshedCount: 9, evidenceCount: 9,
        outcomes: records.map((item) => expect.objectContaining({ profileId: item.id })),
      }),
    });
    expect(peak).toBe(4);
  });

  it('does not begin additional refreshes after caller cancellation', async () => {
    const records = Array.from({ length: 7 }, (_, index) => record(index));
    const controller = new AbortController();
    let startedCount = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const executor: ProfileRefreshExecutor = {
      async refresh() {
        startedCount += 1;
        if (startedCount === 4) notifyStarted();
        await released;
        return { status: 'refreshed', evidenceCount: 1 };
      },
    };
    const service = new AccountsProfileRefreshService({
      clock: { nowMs: () => 10 }, manifestStore: store(records), executor,
    });

    const pending = service.refreshAll(controller.signal);
    await started;
    controller.abort();
    release();
    const result = await pending;

    expect(startedCount).toBe(4);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'partial', refreshedCount: 4, cancelledCount: 3,
        outcomes: [
          ...records.slice(0, 4).map((item) => expect.objectContaining({ profileId: item.id, status: 'refreshed' })),
          ...records.slice(4).map((item) => expect.objectContaining({ profileId: item.id, status: 'cancelled', reasonCode: 'cancelled' })),
        ],
      }),
    });
  });

  it('returns all cancelled without invoking the executor when already aborted', async () => {
    const records = [record(0), record(1)];
    const controller = new AbortController();
    controller.abort();
    const executor: ProfileRefreshExecutor = { refresh: vi.fn() };
    const service = new AccountsProfileRefreshService({
      clock: { nowMs: () => 10 }, manifestStore: store(records), executor,
    });

    expect(await service.refreshAll(controller.signal)).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'cancelled', cancelledCount: 2,
        outcomes: records.map((item) => expect.objectContaining({ profileId: item.id, status: 'cancelled' })),
      }),
    });
    expect(executor.refresh).not.toHaveBeenCalled();
  });

  it('fails before executor effects for a busy gate, unavailable manifest, or invalid clock', async () => {
    const records = [record(0)];
    const executor: ProfileRefreshExecutor = { refresh: vi.fn() };
    const gate = createProfileOperationGate();
    expect(gate.begin()).toBe(true);
    const busy = new AccountsProfileRefreshService({
      clock: { nowMs: () => 1 }, manifestStore: store(records), executor, operationGate: gate,
    });
    expect(await busy.refreshAll()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    gate.end();

    const unavailable = new AccountsProfileRefreshService({
      clock: { nowMs: () => 1 },
      manifestStore: { read: () => ({ ok: false, code: 'corrupt' }), replace: vi.fn() },
      executor,
      operationGate: gate,
    });
    expect(await unavailable.refreshAll()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_store_corrupt' }],
    });

    const invalidClock = new AccountsProfileRefreshService({
      clock: { nowMs: () => Number.NaN }, manifestStore: store(records), executor,
      operationGate: gate,
    });
    expect(await invalidClock.refreshAll()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_refresh_invalid_metadata' }],
    });
    expect(executor.refresh).not.toHaveBeenCalled();
    expect(gate.isBusy()).toBe(false);
  });
});
