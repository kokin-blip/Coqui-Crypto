import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatQuantity, formatUsd, freshnessBadge } from '@coqui/ui-kit';
import { useState } from 'react';

import { PaperComparison } from './PaperComparison.js';
import { AllocationRing } from './AllocationRing.js';
import { ChartViewControl } from './ChartViewControl.js';
import { Reconciliation } from './Reconciliation.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { useWorkspace } from './WorkspaceContext.js';

type PortfolioView = ChannelResponse<'portfolio.view'>;
type Holding = PortfolioView['holdings'][number];

/**
 * The portfolio screen (wireframe screen 2).
 *
 * The header states outright when the total is a **priced subtotal** rather
 * than complete equity. An unpriced holding silently omitted from a total is
 * the predecessor's exact failure mode, and a figure wrong by an unknown amount
 * is worse than one labelled incomplete.
 */

const FRESHNESS_WINDOW_MS = 5 * 60_000;
const AGING_WINDOW_MS = 30 * 60_000;
const PORTFOLIO_VIEWS = [{ value: 'holdings', label: 'Holdings' }, { value: 'allocation', label: 'Allocation' }] as const;
const WORKSPACE_INVALIDATIONS = ['accounts.workspace', 'accounts.settings'] as const;

function priceAge(holding: Holding, asOfMs: number): React.JSX.Element {
  const observed = holding.priceProvenance?.observedAtMs ?? null;
  if (holding.priceProvenance === null) {
    return (
      <span>
        <span aria-hidden="true">○</span> no price source
      </span>
    );
  }
  if (observed === null) {
    // Nullable by design. Several sources report a price with no observation
    // time; showing "0m ago" would invent a freshness we cannot observe.
    const badge = freshnessBadge('unknown', null);
    return (
      <span title={badge.label}>
        <span aria-hidden="true">{badge.marker}</span> {badge.text}
      </span>
    );
  }
  const ageMs = Math.max(0, asOfMs - observed);
  const level = ageMs < FRESHNESS_WINDOW_MS ? 'fresh' : ageMs < AGING_WINDOW_MS ? 'aging' : 'stale';
  const badge = freshnessBadge(level, ageMs);
  return (
    <span title={badge.label}>
      <span aria-hidden="true">{badge.marker}</span> {badge.text}
    </span>
  );
}

function Money({
  value,
  signed = false,
}: {
  readonly value: string | null;
  readonly signed?: boolean;
}): React.JSX.Element {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">unpriced</span>
      </>
    );
  }
  const formatted = formatUsd(value, { signed });
  if (formatted === null) return <span>—</span>;
  return (
    <>
      {signed && <span aria-hidden="true">{formatted.figure.marker} </span>}
      {formatted.text}
    </>
  );
}

function Row({
  holding,
  asOfMs,
  selected,
  onSelect,
}: {
  readonly holding: Holding;
  readonly asOfMs: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <tr aria-selected={selected}>
      <th scope="row" className="pr-4 text-left font-normal">
        <button type="button" className="holding-select" onClick={onSelect} aria-pressed={selected}>
          <strong>{holding.asset.symbol}</strong><span>{holding.asset.name}</span>
        </button>
      </th>
      <td className="pr-4 text-right tabular-nums">
        {formatQuantity(holding.quantity) ?? holding.quantity}
      </td>
      <td className="pr-4 text-right tabular-nums">
        <Money value={holding.priceUsd} />
      </td>
      <td className="pr-4 text-right tabular-nums">
        <Money value={holding.valueUsd} />
      </td>
      <td className="pr-4 text-right tabular-nums">
        <Money value={holding.avgCostUsd} />
      </td>
      <td className="pr-4 text-right tabular-nums">
        <Money value={holding.unrealizedPnlUsd} signed />
      </td>
      <td className="text-right">{priceAge(holding, asOfMs)}</td>
    </tr>
  );
}

function Header({ view }: { readonly view: PortfolioView }): React.JSX.Element {
  const incomplete = view.valuation.unpricedCount > 0;
  return (
    <div className="space-y-1">
      <p className="text-base">
        <span className="font-semibold">ACTUAL PORTFOLIO VALUE</span>{' '}
        <Money value={view.valuation.totalValueUsd} />
        <span className="ml-4 opacity-70">
          priced {view.pricing.pricedCount} of {view.pricing.requestedCount}
        </span>
      </p>
      <p>
        unrealised <Money value={view.valuation.totalUnrealizedPnlUsd} signed />
        <span className="ml-4 opacity-70">
          cost basis <Money value={view.valuation.totalCostUsd} />
        </span>
      </p>
      {incomplete && (
        // Beside the number it qualifies, not in a footnote.
        <p role="note" className="border-l-2 pl-3">
          <span aria-hidden="true">⚠ </span>
          {view.valuation.unpricedCount} holding
          {view.valuation.unpricedCount === 1 ? '' : 's'} unpriced — this total is a{' '}
          <span className="font-semibold">PRICED SUBTOTAL</span>, not complete equity.
        </p>
      )}
    </div>
  );
}

export function Portfolio({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const portfolio = useChannel(client, 'portfolio.view', {});
  const workspace = useWorkspace();
  const workspaceCommand = useCommand(client, 'accounts.workspace.set', WORKSPACE_INVALIDATIONS);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  if (portfolio.kind === 'loading') return <p aria-live="polite">Loading portfolio…</p>;

  if (portfolio.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load the portfolio:{' '}
        {portfolio.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const view = portfolio.value;
  const selected = view.holdings.find((holding) => holding.asset.symbol === selectedSymbol)
    ?? view.holdings[0];
  const portfolioChart = workspace.preferences?.portfolioChart ?? 'holdings';
  const allocation = view.holdings.flatMap((holding) => holding.valueUsd === null ? [] : [{
    id: holding.asset.symbol, label: holding.asset.symbol, valueUsd: holding.valueUsd,
  }]);

  return (
    <section aria-labelledby="portfolio-heading" className="space-y-4">
      <h2 id="portfolio-heading" className="font-semibold">
        Portfolio
      </h2>

      <div className="surface-toolbar">
        <span>Portfolio view</span>
        <ChartViewControl ariaLabel="Portfolio view" disabled={workspaceCommand.state.kind === 'pending'} value={portfolioChart} options={PORTFOLIO_VIEWS} onChange={(value) => void workspaceCommand.run({ commandId: crypto.randomUUID(), patch: { portfolioChart: value } })} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Header view={view} />
        {/* Side by side, so the comparison is the point and neither figure is
            presented as the other. */}
        <PaperComparison
          client={client}
          actualTotalUsd={view.valuation.unpricedCount > 0 ? null : view.valuation.totalValueUsd}
        />
      </div>

      {view.holdings.length === 0 ? (
        <p>No holdings yet — import a Coinbase report or add a tax lot to begin.</p>
      ) : (
        <>
        {portfolioChart === 'allocation' && <section className="panel portfolio-allocation-view" aria-label="Portfolio allocation"><AllocationRing data={allocation} selectedId={selected?.asset.symbol ?? null} onSelect={setSelectedSymbol} /></section>}
        <div className="portfolio-master-detail">
          <div className="portfolio-table-scroll"><table className="w-full text-left">
            <caption className="sr-only">Holdings with cost basis, value and price freshness</caption>
            <thead><tr className="border-b">
              <th scope="col" className="pr-4 font-normal opacity-70">Asset</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">Quantity</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">Price</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">Value</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">Cost</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">Unrealized</th>
              <th scope="col" className="text-right font-normal opacity-70">Observed</th>
            </tr></thead>
            <tbody>{view.holdings.map((holding) => (
              <Row key={holding.asset.symbol} holding={holding} asOfMs={view.asOfMs} selected={selected?.asset.symbol === holding.asset.symbol} onSelect={() => setSelectedSymbol(holding.asset.symbol)} />
            ))}</tbody>
          </table></div>
          {selected !== undefined && <aside className="holding-detail" aria-label={`${selected.asset.symbol} evidence detail`}>
            <p className="section-label">Selected holding</p><h3>{selected.asset.name}</h3><strong className="holding-detail-symbol">{selected.asset.symbol}</strong>
            <dl><div><dt>Market value</dt><dd><Money value={selected.valueUsd} /></dd></div><div><dt>Average cost</dt><dd><Money value={selected.avgCostUsd} /></dd></div><div><dt>Unrealized P&amp;L</dt><dd><Money value={selected.unrealizedPnlUsd} signed /></dd></div><div><dt>Price evidence</dt><dd>{priceAge(selected, view.asOfMs)}</dd></div></dl>
          </aside>}
        </div>
        </>
      )}

      <p className="opacity-70">
        pricing {view.pricing.status} · {view.pricing.requestedSource}
      </p>

      <Reconciliation client={client} />
    </section>
  );
}
