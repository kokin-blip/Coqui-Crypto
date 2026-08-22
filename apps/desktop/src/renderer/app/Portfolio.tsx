import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatQuantity, formatUsd, freshnessBadge } from '@coqui/ui-kit';

import { PaperComparison } from './PaperComparison.js';
import { Reconciliation } from './Reconciliation.js';
import { useChannel } from '../query/use-channel.js';

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
}: {
  readonly holding: Holding;
  readonly asOfMs: number;
}): React.JSX.Element {
  return (
    <tr>
      <th scope="row" className="pr-4 text-left font-normal">
        {holding.asset.symbol}
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

export function Portfolio({
  client,
  profileId,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
}): React.JSX.Element {
  const portfolio = useChannel(client, 'portfolio.view', {});

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

  return (
    <section aria-labelledby="portfolio-heading" className="space-y-4">
      <h2 id="portfolio-heading" className="font-semibold">
        Portfolio
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Header view={view} />
        {/* Side by side, so the comparison is the point and neither figure is
            presented as the other. */}
        <PaperComparison
          client={client}
          profileId={profileId}
          actualTotalUsd={view.valuation.unpricedCount > 0 ? null : view.valuation.totalValueUsd}
        />
      </div>

      {view.holdings.length === 0 ? (
        <p>No holdings yet — import a Coinbase report or add a tax lot to begin.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Holdings with cost basis, value and price freshness</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="pr-4 font-normal opacity-70">ASSET</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">QTY</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">PRICE</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">VALUE</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">COST</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">UNREAL</th>
              <th scope="col" className="text-right font-normal opacity-70">PRICE AS OF</th>
            </tr>
          </thead>
          <tbody>
            {view.holdings.map((holding) => (
              <Row key={holding.asset.symbol} holding={holding} asOfMs={view.asOfMs} />
            ))}
          </tbody>
        </table>
      )}

      <p className="opacity-70">
        pricing {view.pricing.status} · {view.pricing.requestedSource}
      </p>

      <Reconciliation client={client} />
    </section>
  );
}
