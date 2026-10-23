import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCapitalPerformance } from '@coqui/core';
import { batch, DAY, epoch, mark, scope } from './helpers/capital.js';

const channels = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js', () => ({
  useChannel: (_client: unknown, name: string) => channels[name] ?? { kind: 'loading' },
}));
const desktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const react = desktop('react') as { createElement: (component: unknown, props: object) => unknown };
const server = desktop('react-dom/server') as { renderToStaticMarkup: (element: unknown) => string };
// @ts-expect-error TS6142: Vitest compiles renderer JSX; the root test compiler omits JSX support.
const { CapitalPerformancePanel } = await import('../apps/desktop/src/renderer/app/CapitalPerformance.js');
const rows = [mark(0, '500'), mark(DAY, '550')];
const report = calculateCapitalPerformance({ scope, epoch: epoch(rows[0]!), batches: [batch], events: [], valuations: rows });
const descriptor = { scope, label: 'Local paper simulation', mode: 'active', connectionId: null,
  epochs: [epoch(rows[0]!)], latestObservedAtMs: DAY, coverage: batch.coverage };
function render(props: object = {}) { return server.renderToStaticMarkup(react.createElement(CapitalPerformancePanel, { client: {}, ...props })); }
beforeEach(() => {
  channels['capital.scopes'] = { kind: 'ready', isStale: false, value: { schemaVersion: 1, scopes: [descriptor] } };
  channels['capital.performance'] = { kind: 'ready', isStale: false, value: report };
});

describe('capital performance evidence states', () => {
  it('shows corrected performance, period, currency, method and independently unavailable basis metrics', () => {
    const html = render();
    expect(html).toContain('Economic P&amp;L'); expect(html).toContain('$50.00');
    expect(html).toContain('Time-weighted return'); expect(html).toContain('10%');
    expect(html).toContain('Capital accounting v1'); expect(html).toContain('USD');
    expect(html).toContain('Tracking since'); expect(html).toContain('Last source read');
    expect(html).toContain('Unavailable'); expect(html).toContain('cost-basis evidence');
    expect(html).toContain('aria-label="About Annualized return"');
    expect(html).toContain('Selling into cash is not a payment to the user');
  });
  it.each(['loading', 'failed', 'blocked', 'unknown'])('distinguishes %s from an empty or zero balance', (kind) => {
    channels['capital.scopes'] = { kind, issues: [{ path: [], code: 'source_unavailable' }] };
    const html = render(); expect(html).toContain('Capital accounting'); expect(html).not.toContain('$0.00');
  });
  it('keeps a successful empty state separate from source failure', () => {
    channels['capital.scopes'] = { kind: 'ready', value: { schemaVersion: 1, scopes: [] } };
    expect(render()).toContain('no verified account or paper opening is recorded');
  });
  it('keeps balance visible when historical returns cannot be reconstructed', () => {
    channels['capital.performance'] = { kind: 'ready', value: calculateCapitalPerformance({ scope, epoch: null,
      batches: [batch], events: [], valuations: rows }) };
    const html = render(); expect(html).toContain('$550.00'); expect(html).toContain('Earlier performance is unavailable');
    expect(html).toContain('complete economic opening valuation');
  });
  it('requires an explicit account selection rather than combining accounts', () => {
    channels['capital.scopes'] = { kind: 'ready', value: { schemaVersion: 1, scopes: [descriptor,
      { ...descriptor, scope: { ...scope, id: 'b'.repeat(64) }, label: 'Another simulation' }] } };
    const html = render(); expect(html).toContain('Choose an account'); expect(html).toContain('Another simulation');
    expect(html).not.toContain('$550.00');
  });
  it('labels explicitly selected copied history as archived without granting a fresh connection', () => {
    channels['capital.scopes'] = { kind: 'ready', value: { schemaVersion: 1, scopes: [{ ...descriptor, mode: 'archived' }] } };
    expect(render({ selectedScopeId: scope.id })).toContain('Historical evidence only');
  });
  it('announces failed capture while retaining original observation dates', () => {
    channels['capital.scopes'] = { kind: 'ready', value: { schemaVersion: 1, scopes: [{ ...descriptor,
      coverage: { ...batch.coverage, complete: false, reasonCodes: ['capital_ingestion_failed'] } }] } };
    const html = render(); expect(html).toContain('latest accounting capture failed'); expect(html).toContain('$550.00');
  });
});
