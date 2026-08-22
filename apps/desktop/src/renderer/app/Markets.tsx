import type { CoquiClient } from '@coqui/contracts';
import { freshnessBadge, provenanceBadge } from '@coqui/ui-kit';

import { DeferredPanel } from './DeferredPanel.js';
import { useChannel } from '../query/use-channel.js';

/**
 * Reference market data.
 *
 * Every figure on this screen is informational and none of it reaches a
 * strategy — the service types it `informationalOnly` and `neverASignal`, and
 * the screen repeats that where a user can see it. Trending in particular ranks
 * what people are *searching for*, not what is performing.
 */

function Provenance({
  source,
  freshness,
  ageMs,
}: {
  readonly source: string;
  readonly freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  readonly ageMs: number | null;
}): React.JSX.Element {
  const fresh = freshnessBadge(freshness, ageMs);
  const badge = provenanceBadge({ source, informationalOnly: true });
  return (
    <p className="opacity-70">
      <span aria-hidden="true">{fresh.marker}</span> {fresh.text} · {badge.text}
      <span className="sr-only">
        {' '}
        {fresh.label}. {badge.label}.
      </span>
    </p>
  );
}

export function Markets({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const fearGreed = useChannel(client, 'market-data.fear-greed', {});
  const trending = useChannel(client, 'market-data.trending', {});

  return (
    <section aria-labelledby="markets-heading" className="space-y-4">
      <h2 id="markets-heading" className="font-semibold">
        Markets
      </h2>

      <p role="note" className="border-l-2 pl-3">
        Reference data. None of this reaches a trading decision — it is context for a
        person, not an input to a strategy.
      </p>

      <div>
        <h3 className="font-semibold">Sentiment</h3>
        {fearGreed.kind === 'loading' && <p aria-live="polite">Loading…</p>}
        {fearGreed.kind === 'ready' && (
          <>
            <p className="text-base tabular-nums">
              {fearGreed.value.data.value} · {fearGreed.value.data.classification}
            </p>
            <Provenance
              source={fearGreed.value.provenance.source}
              freshness={fearGreed.value.provenance.freshness}
              ageMs={fearGreed.value.provenance.ageMs}
            />
          </>
        )}
        {fearGreed.kind === 'failed' && (
          <p>Sentiment unavailable — {fearGreed.issues.map((i) => i.code).join(', ')}.</p>
        )}
      </div>

      <div>
        <h3 className="font-semibold">Trending searches</h3>
        <p className="opacity-70">
          What people are looking up, not what is performing.
        </p>
        {trending.kind === 'loading' && <p aria-live="polite">Loading…</p>}
        {trending.kind === 'ready' && trending.value.data.length === 0 && (
          <p>Nothing trending right now.</p>
        )}
        {trending.kind === 'ready' && trending.value.data.length > 0 && (
          <>
            <ul>
              {trending.value.data.map((coin) => (
                <li key={coin.coingeckoId}>
                  {coin.symbol} · {coin.name}
                  {coin.marketCapRank !== null && (
                    <span className="opacity-70"> · rank {coin.marketCapRank}</span>
                  )}
                </li>
              ))}
            </ul>
            <Provenance
              source={trending.value.provenance.source}
              freshness={trending.value.provenance.freshness}
              ageMs={trending.value.provenance.ageMs}
            />
          </>
        )}
        {trending.kind === 'failed' && (
          <p>Trending unavailable — {trending.issues.map((i) => i.code).join(', ')}.</p>
        )}
      </div>

      <DeferredPanel
        title="Watchlist"
        phase="P8"
        reason="The predecessor's watchlist tracked attributed public blockchain addresses, not coins. It stays out until attribution can be modelled without implying it has been verified."
      />
    </section>
  );
}
