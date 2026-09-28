import { DatabaseSync } from 'node:sqlite';

const databasePath = process.argv[2];
if (!databasePath) {
  process.stderr.write('Usage: node scripts/analyze-parallel-paper-execution.mjs /path/to/coqui.db\n');
  process.exitCode = 2;
} else {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const experiment = database.prepare('SELECT id FROM parallel_paper_experiments_v1 ORDER BY started_at DESC LIMIT 1').get();
    if (!experiment) throw new Error('No parallel paper experiment is recorded.');
    const events = database.prepare(`SELECT kind, at, detail_json FROM parallel_paper_events_v1
      WHERE experiment_id=? ORDER BY rowid`).all(experiment.id)
      .map((row) => ({ kind: row.kind, at: row.at, detail: JSON.parse(row.detail_json) }));
    const checks = events.filter((event) => event.kind === 'intraday_check');
    const orders = events.filter((event) => event.kind === 'external_order');
    const fills = events.filter((event) => event.kind === 'external_fill');
    const observations = [];
    for (const check of checks) {
      const slot = check.detail.slot;
      const nextCheck = checks.find((event) => event.at > check.at);
      const plans = events.filter((event) => event.kind === 'intraday_plan' && event.detail.slot === slot);
      const before = plans.find((event) => event.detail.stage === 'sell')?.detail.accountBefore;
      const after = events.find((event) => event.kind === 'account_mark' && (event.detail.slot ?? event.detail.markKey) === slot)?.detail;
      const trades = plans.flatMap((plan) => (plan.detail.diagnostics ?? []).map((diagnostic) => {
        const acknowledged = orders.filter((event) => event.detail.clientOrderId === diagnostic.clientOrderId).at(-1);
        const orderFills = fills.filter((event) => event.detail.orderId === acknowledged?.detail.orderId);
        const quantity = Number(acknowledged?.detail.filledQty ?? 0);
        const fillPrice = Number(acknowledged?.detail.filledAvgPrice ?? 0);
        const midpoint = Number(diagnostic.midpoint);
        const nextSides = nextCheck?.detail.quotes?.[diagnostic.symbol];
        const nextMidpoint = nextSides ? (Number(nextSides.bid) + Number(nextSides.ask)) / 2 : null;
        const side = plan.detail.stage;
        const feeRate = 0.0025;
        const versusNoTradeUsd = quantity > 0 && fillPrice > 0 && nextMidpoint !== null
          ? side === 'buy'
            ? quantity * ((1 - feeRate) * nextMidpoint - fillPrice)
            : quantity * ((1 - feeRate) * fillPrice - nextMidpoint)
          : null;
        return { symbol: diagnostic.symbol, side, status: acknowledged?.detail.status ?? 'unacknowledged',
          fillRows: orderFills.length, filledQuantity: quantity, quoteBid: Number(diagnostic.bid),
          quoteAsk: Number(diagnostic.ask), quoteMidpoint: midpoint,
          expectedEntryCostUsd: Number(diagnostic.expectedEntryCostUsd),
          expectedEntryCostPct: Number(diagnostic.expectedEntryCostPct),
          shadowCostScreen: diagnostic.shadowCostScreen, fillPrice: fillPrice || null,
          fillPremiumToQuoteUsd: fillPrice > 0 ? quantity * (side === 'buy' ? fillPrice - midpoint : midpoint - fillPrice) : null,
          nextQuoteSlot: nextCheck?.detail.slot ?? null, nextQuoteMidpoint: nextMidpoint,
          marketOrderVersusNoTradeUsdAtNextQuote: versusNoTradeUsd,
          passiveLimitIfFilledAtQuote: { price: side === 'buy' ? Number(diagnostic.bid) : Number(diagnostic.ask),
            makerFeePctAssumption: 0.15, fillObserved: false } };
      }));
      observations.push({ slot, quoteObservedAt: new Date(check.detail.quoteAtMs).toISOString(),
        beforeEquityUsd: before ? Number(before.equityUsd) : null,
        afterEquityUsd: after ? Number(after.alpacaEquityUsd) : null,
        immediateEquityChangeUsd: before && after ? Number(after.alpacaEquityUsd) - Number(before.equityUsd) : null,
        trades });
    }
    const matched = observations.flatMap((slot) => slot.trades)
      .filter((trade) => trade.marketOrderVersusNoTradeUsdAtNextQuote !== null);
    process.stdout.write(`${JSON.stringify({
      assumptions: { takerFeePctPerSide: 0.25, passiveLimitFillProbability: 'unmeasured',
        comparisonHorizon: 'next recorded four-hour slot quote; no matched quote means no comparison' },
      observedOrders: new Set(orders.map((event) => event.detail.orderId)).size,
      partialFillRows: fills.length,
      feeActivities: events.filter((event) => event.kind === 'external_fee').map((event) => event.detail),
      feeCoverage: 'Unreported fees are unknown; reported fees may be account-level and delayed.',
      slots: observations,
      matchedSummary: { tradeCount: matched.length,
        marketOrderVersusNoTradeUsd: matched.length === 0 ? null : Number(matched.reduce((sum, trade) =>
          sum + trade.marketOrderVersusNoTradeUsdAtNextQuote, 0).toFixed(2)),
        shadowSkippedTradeCount: matched.filter((trade) => trade.shadowCostScreen === 'skip').length,
        shadowSkippedMarketOutcomeUsd: matched.some((trade) => trade.shadowCostScreen === 'skip')
          ? Number(matched.filter((trade) => trade.shadowCostScreen === 'skip')
            .reduce((sum, trade) => sum + trade.marketOrderVersusNoTradeUsdAtNextQuote, 0).toFixed(2)) : null },
    }, null, 2)}\n`);
  } finally {
    database.close();
  }
}
