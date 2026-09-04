import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import { createChartExtensionHandlers } from '../apps/desktop/src/main/chart-extension-handlers.js';
import { openDatabase } from '../packages/storage/src/index.js';

describe('native chart-extension package picker', () => {
  it('returns and durably deduplicates a sanitized cancellation', async () => {
    const database = openDatabase(':memory:');
    let calls = 0;
    const handlers = createChartExtensionHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), pickPackage: async () => { calls += 1; return null; } });
    const payload = { commandId: randomUUID(), confirmed: true };
    const handler = handlers['chart-extensions.install.pick'] as unknown as (value: unknown) => Promise<unknown>;
    const first = await handler(payload);
    const second = await handler(payload);
    expect(first).toEqual({ ok: true, value: { outcome: 'cancelled' } });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    database.close();
  });
});
