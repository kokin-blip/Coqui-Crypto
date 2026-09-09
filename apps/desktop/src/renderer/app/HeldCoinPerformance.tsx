import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { CHART_COLORS } from '@coqui/ui-kit';

import { FinancialChart } from './FinancialChart.js';
import { routeHash } from './routes.js';
import { SurfaceState } from './SurfaceState.js';

type Exposure = NonNullable<ChannelResponse<'portfolio.current'>>['exposures'][number];
const COLORS = [CHART_COLORS.primary, CHART_COLORS.benchmark, '#f2b84b', '#57c7e3', '#ff8f70', '#b8d86b', '#d58cff', '#71a7ff'];

export function HeldCoinPerformance({ client, exposures }: {
  readonly client: CoquiClient;
  readonly exposures: readonly Exposure[];
}): React.JSX.Element {
  const held = useMemo(() => exposures.filter((item) => item.exposureKey !== 'USD' &&
    Number(item.quantity) > 0).sort((a, b) => Number(b.valueUsd ?? 0) - Number(a.valueUsd ?? 0)).slice(0, 8), [exposures]);
  const queries = useQueries({ queries: held.map((item) => ({
    queryKey: ['overview-held-performance', item.exposureKey],
    queryFn: () => client.query('market-data.candles', { instrument: {
      venue: 'coinbase', productId: `${item.exposureKey}-USD`, productType: 'spot',
    }, lookbackDays: 365 }), staleTime: 60 * 60_000, retry: false,
  })) });
  const series = held.slice(0, 5).flatMap((item, index) => {
    const outcome = queries[index]?.data;
    if (outcome?.status !== 'ok' || outcome.value.bars.length === 0) return [];
    const first = outcome.value.bars[0]?.close;
    if (first === undefined || first <= 0) return [];
    return [{ id: item.exposureKey, label: item.exposureKey, color: COLORS[index]!,
      values: outcome.value.bars.map((bar) => ({ day: new Date(bar.startTimeMs).toISOString().slice(0, 10),
        value: bar.close / first * 100 })) }];
  });
  const unavailable = held.filter((_item, index) => {
    const outcome = queries[index]?.data;
    return outcome !== undefined && (outcome.status !== 'ok' || outcome.value.bars.length === 0);
  });
  if (held.length === 0) return <SurfaceState kind="empty" title="No connected crypto holdings" detail="Sync a connection to derive performance from the active profile." action={{ label: 'Open connections', href: routeHash('settings') }} compact />;
  return <div className="held-performance-stack">
    {series.length > 0 ? <FinancialChart client={client} filenameStem="coqui-held-coin-performance"
      series={series} style="line" summary="Completed Coinbase daily performance normalized to 100 for the five largest priced connected crypto exposures." />
      : <SurfaceState kind="empty" title="Held-coin history unavailable" detail="Refresh Markets after completed Coinbase daily bars become available." action={{ label: 'Open Markets', href: routeHash('markets') }} compact />}
    <p className="chart-footnote">Completed Coinbase daily bars · normalized to 100 · display only</p>
    {unavailable.length > 0 && <p className="chart-footnote">Unavailable: {unavailable.map((item) => item.exposureKey).join(', ')}</p>}
  </div>;
}
