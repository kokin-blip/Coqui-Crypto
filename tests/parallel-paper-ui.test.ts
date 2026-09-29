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

  it('shows intraday monitoring and recorded defensive filter counts', () => {
    mocked.channels['parallel.paper.status'] = { kind: 'ready', value: {
      state: 'active', runtimeState: 'intraday', lastCheckAtMs: Date.now(), lastDecisionAtMs: Date.now(),
      lastReason: null, lastMarkDay: null, coquiOpeningUsd: '1000', alpacaOpeningUsd: '100000',
      coquiEquityUsd: null, alpacaEquityUsd: null, coquiReturnPct: null, alpacaReturnPct: null,
      coquiFeesUsd: '0', alpacaBookedFeesUsd: null, alpacaModeledFrictionUsd: '0',
      coquiFillCount: 0, alpacaFillCount: 0, alpacaOrderCount: 0, positions: [], targets: [], recentTrades: [],
      latestDecision: { day: '2026-09-23', exposurePct: '70', cashPct: '30', mixVolPct: '42',
        belowTrend: true, filters: { negativeMomentumAssets: 1, assetVolScaledAssets: 2,
          portfolioVolScaled: true, trendCapApplied: true }, targets: [] },
      filterSummary: { observedDecisions: 3, negativeMomentumDays: 2, assetVolScaledDays: 3,
        portfolioVolScaledDays: 2, trendCapDays: 1 },
      mlSignal: { gate: 'collecting', reason: 'hourly_history_incomplete', version: null,
        modelHash: null, datasetHash: null, predictedAtMs: null, evidence: null,
        lastSlot: null, lastApplied: null, lastReason: null,
        lastBaseline: [], lastProposed: [], lastCombined: [] },
      hourlyShadow: { version: 'trendvol-hourly-execution-v1', mode: 'shadow', startMs: null,
        lastSlotMs: null, observationCount: 0, completeDays: 0,
        lastModeledOrderCount: 0, lastModeledOrders: [], lastBlockedReasons: [], lastFailureReason: null },
      activity: [{ id: 'a'.repeat(64), atMs: Date.now(), kind: 'no_trade',
        title: 'No intraday order needed', detail: '0 paper orders', alpacaOrderId: null }],
    } };
    const html = render();
    expect(html).toContain('Monitoring intraday paper rebalances');
    expect(html).toContain('Across 3 recorded daily decisions');
    expect(html).toContain('No intraday order needed');
    expect(html).toContain('not execution-matched');
    expect(html).toContain('ML signal worker');
    expect(html).toContain('collecting hourly history');
    expect(html).toContain('Hourly execution candidate · shadow only');
    expect(html).toContain('awaiting registration');
    const shadowReady = mocked.channels['parallel.paper.status'] as { kind: string; value: Record<string, unknown> };
    mocked.channels['parallel.paper.status'] = { ...shadowReady, value: { ...shadowReady.value,
      hourlyShadow: { version: 'trendvol-hourly-execution-v1', mode: 'shadow',
        startMs: Date.now() - 86_400_000, lastSlotMs: Date.now() - 3_600_000,
        observationCount: 24, completeDays: 1, lastModeledOrderCount: 1,
        lastModeledOrders: [{ symbol: 'BTCUSD', side: 'buy', quantity: '1', filledQuantity: '0.5', remainingQuantity: '0.5' }],
        lastBlockedReasons: ['cooldown'], lastFailureReason: 'stale_alpaca_quote' } } };
    expect(render()).toContain('1 complete 24-hour days');
    expect(render()).toContain('1 modeled order');
    expect(render()).toContain('Virtual buy BTCUSD');
    expect(render()).toContain('Latest shadow read unavailable');
    const current = mocked.channels['parallel.paper.status'] as { kind: string; value: Record<string, unknown> };
    const mlSignal = current.value['mlSignal'] as Record<string, unknown>;
    mocked.channels['parallel.paper.status'] = { ...current, value: { ...current.value,
      mlSignal: { ...mlSignal, gate: 'unqualified', reason: 'holdout_net_lift_nonpositive',
        lastSlot: '2026-09-24T08', lastApplied: false, lastReason: 'holdout_net_lift_nonpositive',
        lastBaseline: [{ symbol: 'BTCUSD', weightPct: '20.0' }],
        lastProposed: [{ symbol: 'BTCUSD', weightPct: '30.0' }],
        lastCombined: [{ symbol: 'BTCUSD', weightPct: '20.0' }] } } };
    expect(render()).toContain('shadow only');
    expect(render()).toContain('TrendVol target retained');
    const updated = mocked.channels['parallel.paper.status'] as { kind: string; value: Record<string, unknown> };
    mocked.channels['parallel.paper.status'] = { ...updated, value: { ...updated.value,
      mlSignal: { ...(updated.value['mlSignal'] as Record<string, unknown>),
        gate: 'qualified', reason: 'qualified', predictedAtMs: Date.now(), lastApplied: true } } };
    expect(render()).toContain('research qualified · shadow only');
    expect(render()).toContain('ML target applied');
    const qualified = mocked.channels['parallel.paper.status'] as { kind: string; value: Record<string, unknown> };
    mocked.channels['parallel.paper.status'] = { ...qualified, value: { ...qualified.value,
      state: 'paused', runtimeState: 'attention', lastReason: 'alpaca_unavailable' } };
    expect(render()).toContain('Retrying Alpaca connection');
    expect(render()).toContain('Alpaca read failed · retrying on the next check');
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
