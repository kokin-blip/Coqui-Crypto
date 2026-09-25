import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ channels: {} as Record<string, unknown>, commandState: { kind: 'idle' } as unknown }));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js', () => ({ useChannel: (_client: unknown, channel: string) => mocked.channels[channel] ?? { kind: 'loading' } }));
vi.mock('../apps/desktop/src/renderer/query/use-command.js', () => ({ useCommand: () => ({ state: mocked.commandState, value: null, run: async () => {}, reset: () => {} }) }));

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const react = requireDesktop('react') as { createElement: (type: unknown, props: object) => unknown };
const server = requireDesktop('react-dom/server') as { renderToStaticMarkup: (element: unknown) => string };
// The root test tsconfig has no JSX transform; Vitest compiles this renderer module.
// @ts-expect-error TS6142: the root test compiler intentionally omits JSX support.
const { ParallelPaperComparison } = await import('../apps/desktop/src/renderer/app/ParallelPaperComparison.js');
// @ts-expect-error TS6142: the root test compiler intentionally omits JSX support.
const { ParallelPaperSettings } = await import('../apps/desktop/src/renderer/app/ParallelPaperSettings.js');
// @ts-expect-error TS6142: the root test compiler intentionally omits JSX support.
const { CoinbaseMarketContext } = await import('../apps/desktop/src/renderer/app/CoinbaseMarketContext.js');

function render(component: unknown = ParallelPaperComparison): string {
  return server.renderToStaticMarkup(react.createElement(component, { client: {} as never }));
}

describe('Alpaca paper activity panel', () => {
  it('shows a setup path when no experiment exists', () => {
    mocked.channels['parallel.paper.status'] = { kind: 'ready', value: { state: 'none' } };
    expect(render()).toContain('No Alpaca paper experiment yet');
    expect(render()).toContain('Open Settings');
  });

  it('reports unavailable status instead of an empty panel', () => {
    mocked.channels['parallel.paper.status'] = { kind: 'failed', issues: [{ path: [], code: 'transport_unavailable' }] };
    expect(render()).toContain('Alpaca activity unavailable');
    expect(render()).toContain('transport_unavailable');
  });

  it('does not present the legacy campaign exercise as an Alpaca start gate', () => {
    mocked.channels['parallel.paper.status'] = { kind: 'ready', value: { state: 'none' } };
    mocked.commandState = { kind: 'idle' };
    const html = render(ParallelPaperSettings);
    expect(html).toContain('Start parallel paper experiment');
    expect(html).not.toContain('Review campaign safety stop');
    expect(html).not.toContain('Paper safety stop is engaged');
  });

  it('labels populated, stale, and unavailable Coinbase context independently of Alpaca', () => {
    mocked.channels['market-data.coinbase-diagnostics'] = { kind: 'ready', value: {
      productId: 'BTC-USD', quote: { state: 'fresh', observedAtMs: 1_000,
        data: { bid: '100', ask: '101', observedAtMs: 1_000 } },
      product: { state: 'stale', observedAtMs: 500,
        data: { status: 'online', tradingDisabled: false, cancelOnly: false,
          limitOnly: false, postOnly: false, baseIncrement: '0.01', quoteIncrement: '0.01', quoteMinSize: '1' } },
      book: { state: 'unavailable', observedAtMs: null, data: null },
    } };
    const html = server.renderToStaticMarkup(react.createElement(CoinbaseMarketContext,
      { client: {} as never, productId: 'BTC-USD' }));
    expect(html).toContain('Coinbase market context');
    expect(html).toContain('Best Bid/Ask');
    expect(html).toContain('Stale');
    expect(html).toContain('Get Product Book · Unavailable');
    expect(html).toContain('informational only');
    const current = mocked.channels['market-data.coinbase-diagnostics'] as { kind: string; value: Record<string, unknown> };
    mocked.channels['market-data.coinbase-diagnostics'] = { ...current, value: {
      ...current.value, book: { state: 'fresh', observedAtMs: 1_000,
        data: { bids: [{ price: '100', size: '2' }], asks: [{ price: '101', size: '3' }], observedAtMs: 1_000 } },
    } };
    const populated = server.renderToStaticMarkup(react.createElement(CoinbaseMarketContext,
      { client: {} as never, productId: 'BTC-USD' }));
    expect(populated).toContain('<h4>Bids</h4>');
    expect(populated).toContain('<h4>Asks</h4>');
    expect(populated).toContain('1 bid / 1 ask levels');
  });
});
