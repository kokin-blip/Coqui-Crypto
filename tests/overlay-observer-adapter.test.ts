import { describe, it, expect } from 'vitest';
import { fetchObservedShadowOpen, type HttpClient, type HttpResult } from '../packages/adapters/src/index.js';
import { OVERLAY_ASSETS, OVERLAY_START } from './overlay-fixtures.js';
describe('public research open capture', () => {
  it('uses read-only public requests and refuses historical or delayed opens', async () => {
    let gets = 0, posts = 0, now = OVERLAY_START + 10000;
    const http: HttpClient = { getJson: async <T>() => { gets++; return { ok: true, status: 200, data: [[OVERLAY_START / 1000, 99, 102, 100, 101, 20]] } as HttpResult<T>; },
      postJson: async () => { posts++; throw new Error('unexpected submission'); }, getText: async () => { throw new Error('unused'); }, destroy: () => {} };
    const captured = await fetchObservedShadowOpen(http, OVERLAY_ASSETS, () => now);
    expect(captured?.prices.size).toBe(3); expect(captured?.observedAtMs).toBe(now); expect(captured?.sourceHash).toHaveLength(64);
    now = OVERLAY_START + 60001; expect(await fetchObservedShadowOpen(http, OVERLAY_ASSETS, () => now)).toBeNull();
    expect(gets).toBe(3); expect(posts).toBe(0);
    now = OVERLAY_START + 86400000 + 30000; expect(await fetchObservedShadowOpen(http, OVERLAY_ASSETS, () => now)).toBeNull();
    expect(posts).toBe(0);
  });
});
