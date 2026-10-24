import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateCapitalFeasibility, projectAccountBudget } from '@coqui/core';
import { NOW, SCOPE, feasibility, source } from './helpers/feasibility.js';
const channels = vi.hoisted(() => ({} as Record<string, unknown>));
const calls = vi.hoisted(() => ([] as { name: string; enabled: boolean | undefined }[]));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js', () => ({ useChannel: (_client: unknown, name: string, _payload: unknown, enabled?: boolean) => {
  calls.push({ name, enabled }); return channels[name] ?? { kind: 'loading' };
} }));
const desktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const react = desktop('react') as { createElement: (component: unknown, props: object) => unknown };
const server = desktop('react-dom/server') as { renderToStaticMarkup: (element: unknown) => string };
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root tests omit JSX support.
const { CapitalFeasibility, CapitalFeasibilityResult } = await import('../apps/desktop/src/renderer/app/CapitalFeasibility.js');
function render(component = CapitalFeasibility, props: object = {}) { return server.renderToStaticMarkup(react.createElement(component, { client: {}, ...props })); }
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW); calls.length = 0;
  channels['capital.scopes'] = { kind: 'ready', value: { schemaVersion: 1, scopes: [{ scope: { id: SCOPE }, mode: 'active', label: 'Local simulation' }] } };
  channels['capital.budget'] = { kind: 'ready', value: { schemaVersion: 1, budget: projectAccountBudget(source(), [], NOW), nativeRules: [], reasonCodes: [] } };
});
afterEach(() => vi.restoreAllMocks());
describe('P2 capital evidence and scenario UX', () => {
  it('shows observed cash separately from capacity, expiry, claims and evidence', () => {
    const html = render(); expect(html).toContain('Observed cash'); expect(html).toContain('Cash after obligations');
    expect(html).toContain('$500.00'); expect(html).toContain('evidence expires'); expect(html).toContain('account-budget-v1');
    expect(html).toContain('About Cash after obligations'); expect(html).toContain('Explore a small starting balance');
    expect(calls.find(row => row.name === 'capital.feasibility')?.enabled).toBe(false);
  });
  it('keeps observed balances visible when ownership or holds make capacity unavailable', () => {
    const budget = projectAccountBudget(source({ authority: 'legacy_writer', holdMatchingComplete: false }), [], NOW);
    channels['capital.budget'] = { kind: 'ready', value: { budget, nativeRules: [], reasonCodes: [] } };
    const html = render(); expect(html).toContain('$500.00'); expect(html).toContain('Capacity unavailable');
    expect(html).toContain('Another execution path may be using this account'); expect(html).toContain('Open obligations have not been reconciled');
  });
  it('removes expired capacity without changing the original observation time', () => {
    vi.mocked(Date.now).mockReturnValue(NOW + 30_000);
    const html = render(); expect(html).toContain('Unavailable (expired)'); expect(html).toContain('$500.00');
  });
  it('makes independent hypothetical scenarios available with no verified book', () => {
    channels['capital.scopes'] = { kind: 'ready', value: { scopes: [] } };
    const html = render(); expect(html).toContain('No verified account'); expect(html).toContain('Starting cash (USD)');
    expect(html).toContain('Evaluate scenario'); expect(html).toContain('not current account terms');
    expect(calls.some(row => row.name === 'capital.budget')).toBe(false);
  });
  it.each(['loading', 'failed', 'blocked', 'unknown'])('keeps %s account states distinct from a zero balance', kind => {
    channels['capital.scopes'] = { kind, issues: [{ path: [], code: 'source_unavailable' }] };
    const html = render(); expect(html).toContain('Budget accounts'); expect(html).not.toContain('$0.00');
  });
  it('shows an infeasible subset, cost assumptions and the absence of a certified global floor', () => {
    const input = feasibility('100');
    const report = evaluateCapitalFeasibility({ ...input, policy: { ...input.policy, discretionaryFloorUsd: '25' } });
    const html = render(CapitalFeasibilityResult, { report });
    expect(html).toContain('Hypothetical result: infeasible'); expect(html).toContain('Trade is below the discretionary dollar floor');
    expect(html).toContain('Operating floor: unavailable'); expect(html).toContain('grants no order permission');
  });
});
