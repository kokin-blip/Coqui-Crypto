// Read-only incident replay. Run `pnpm build` first to refresh workspace modules.
// No credentials, network calls, commands, or writes to the supplied database.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
const services = process.argv[3]
  ? new URL('node_modules/@coqui/services/dist/paper/', pathToFileURL(`${resolve(process.argv[3])}/`))
  : new URL('../../../../packages/services/dist/paper/', import.meta.url);
const { reconcilePaperPositionEvidence } = await import(new URL('parallel-paper-minor-recovery.js', services));
const { validateParallelPositions } = await import(new URL('parallel-paper-recovery.js', services));
const { projectParallelPaperActivity } = await import(new URL('parallel-paper-activity.js', services));

const path = process.argv[2];
if (!path) throw new Error('Pass the profile database path and optionally an extracted application root');
const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
let experiment, history;
try {
  db.exec('BEGIN');
  const row = db.prepare('SELECT * FROM parallel_paper_experiments_v1 ORDER BY started_at DESC LIMIT 1').get();
  if (!row) throw new Error('No paper experiment');
  experiment = { id: row.id, profileId: row.profile_id, alpacaAccountId: row.alpaca_account_id, startedAt: row.started_at };
  history = db.prepare('SELECT * FROM parallel_paper_events_v1 WHERE experiment_id = ? ORDER BY at, rowid').all(row.id)
    .map(row => ({ id: row.id, kind: row.kind, at: row.at, detail: JSON.parse(row.detail_json) }));
} finally { db.close(); }

const failure = history.findLast(row => row.kind === 'reconciliation_error' && row.detail.positionDifferences?.length);
const mark = history.findLast(row => row.kind === 'account_mark');
if (!failure || !mark) throw new Error('Missing position mismatch or account mark');
const differences = failure.detail.positionDifferences;
const now = failure.at;
// Controlled responses use historical marks as prices, timestamped for this replay.
// They prove the policy path, not current provider price/fee completeness.
const positions = mark.detail.positions.map(row => ({ symbol: row.symbol, qty: row.alpacaQty }));
const quotes = Object.fromEntries(mark.detail.positions.map(row => {
  const price = String(Number(row.alpacaValueUsd) / Number(row.alpacaQty));
  return [row.symbol.replace('USD', '/USD'), { bp: price, ap: price, t: new Date(now).toISOString() }];
}));
let quoteScale = 1;
const client = {
  positions: async () => positions,
  account: async () => ({ id: experiment.alpacaAccountId, currency: 'USD', status: 'PAPER_ONLY',
    account_blocked: false, trading_blocked: false, equity: mark.detail.alpacaEquityUsd }),
  latestCryptoQuotes: async () => ({ quotes: Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) =>
    [symbol, { ...quote, bp: String(Number(quote.bp) * quoteScale), ap: String(Number(quote.ap) * quoteScale) }])) }),
};
const events = history.filter(row => ['external_fill', 'external_fee', 'external_order',
  'broker_activity_metadata', 'paper_position_resolution'].includes(row.kind));
const appended = [];
let fullAudits = 0;
await assert.rejects(reconcilePaperPositionEvidence({ experiment, client, events: () => [...events, ...appended],
  now: () => now, allowMinorResolution: true, fullAudit: async () => { fullAudits += 1; },
  append: (kind, key, detail) => appended.push({ id: key, kind, at: now, detail }),
}), error => error.message === 'broker_positions_mismatch');
assert.equal(fullAudits, 1);
assert.equal(appended.some(row => row.kind === 'paper_position_resolution'), false);

// Synthetic fee evidence exists only in memory. It must never be booked as real fees.
const hypotheticalFees = differences.map((row, i) => ({ id: `hypothetical-${i}`, kind: 'external_fee',
  at: now, detail: { symbol: row.symbol, quantity: row.differenceQty } }));
await validateParallelPositions(client, [...events, ...hypotheticalFees]);
assert.equal(projectParallelPaperActivity([failure]).activity[0].title, 'Alpaca position reconciliation mismatch');
const approximateGapUsd = differences.reduce((sum, row) =>
  sum + Math.abs(Number(row.differenceQty)) * Number(quotes[row.symbol.replace('USD', '/USD')].ap), 0);
assert.ok(approximateGapUsd > 25);
assert.ok(approximateGapUsd > Number(mark.detail.alpacaEquityUsd) * 0.0005);
// Lower only the mocked prices: the same fee-shape/account/ledger checks now pass.
// This distinguishes the value ceiling from the earlier classification gates.
quoteScale = 0.1;
await reconcilePaperPositionEvidence({ experiment, client, events: () => [...events, ...appended],
  now: () => now, allowMinorResolution: true, fullAudit: async () => {},
  append: (kind, key, detail) => appended.push({ id: key, kind, at: now, detail }),
});
assert.equal(appended.some(row => row.kind === 'paper_position_resolution'), true);
console.log(JSON.stringify({ replay: 'passed', approximateGapUsd: approximateGapUsd.toFixed(2),
  blockedAboveBothRecoveryLimits: true, hypotheticalMatchingFeesReconcile: true,
  lowerMockPricesPassClassification: true, activityLabelsReconciliationMismatch: true,
  databaseWrites: 0, networkRequests: 0 }, null, 2));
