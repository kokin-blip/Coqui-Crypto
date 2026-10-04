/** Read-only preflight for the fixed TrendVol spread-floor comparison. */
import { resolve } from 'node:path';
import { buildDecisionMarketDataset, instrumentKey } from '../packages/core/dist/index.js';
import { queryMarketBarArchive, verifyMarketBarArchive } from '../packages/storage/dist/index.js';

const DAY = 86_400_000;
const startMs = Date.UTC(2016, 0, 1), endExclusiveMs = Date.UTC(2026, 6, 1);
const archives = [
  { productId: 'XBTUSD', hash: '58fa1bead01ab7f3b0fd4e7da71c37fccb24c0d5a532d602e183b29653681b2b' },
  { productId: 'ETHUSD', hash: 'e0daf1ebeed234c173e809ce332334d8c7b65471267401bf349513c73b796e5f' },
];
const input = {}, sources = [];
for (const archive of archives) {
  const directory = resolve('data/research-archive/datasets', archive.hash);
  const manifest = await verifyMarketBarArchive(directory);
  if (manifest.files.some((file) => file.venue !== 'kraken' || file.productId !== archive.productId || file.interval !== '1d')) {
    throw new Error(`Unexpected archive instruments: ${archive.hash}`);
  }
  const rows = await queryMarketBarArchive(directory, {
    venue: 'kraken', productId: archive.productId, startTimeMs: startMs, endTimeMs: endExclusiveMs,
  });
  const assetId = instrumentKey({ venue: 'kraken', productId: archive.productId, productType: 'spot' });
  input[assetId] = rows.map((row) => ({
    assetId, source: row.source, interval: row.interval,
    startTimeMs: row.startTimeMs, endTimeMs: row.endTimeMs,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume), isComplete: row.isComplete,
    retrievedAtMs: row.retrievedAtMs, quality: row.quality,
  }));
  const observed = new Set(rows.map((row) => row.startTimeMs));
  const missingDays = [];
  for (let time = startMs; time < endExclusiveMs; time += DAY) {
    if (!observed.has(time)) missingDays.push(new Date(time).toISOString().slice(0, 10));
  }
  sources.push({ assetId, datasetHash: manifest.datasetHash, manifestHash: manifest.manifestHash,
    verified: true, expectedBars: (endExclusiveMs - startMs) / DAY, observedBars: rows.length, missingDays });
}
const generatedAtMs = Math.max(endExclusiveMs, ...Object.values(input).flatMap((bars) => bars.map((bar) => bar.retrievedAtMs)));
const dataset = buildDecisionMarketDataset(input, Object.keys(input), {
  policy: 'reject-on-gap', expectedSource: 'kraken', nowMs: generatedAtMs,
});
const unexpectedQuality = Object.values(input).flat().filter((bar) => bar.quality !== 'reported_ohlc').length;
const valid = sources.every((source) => source.missingDays.length === 0 && source.observedBars === source.expectedBars)
  && dataset.report.issues.length === 0 && dataset.dayKeys.length === (endExclusiveMs - startMs) / DAY && unexpectedQuality === 0;
console.log(JSON.stringify({ studyId: 'trendvol-spread-floor-v1', status: valid ? 'data_ready' : 'blocked_data_validation',
  label: 'Kraken-price proxy research with Coinbase costs',
  development: { start: new Date(startMs).toISOString(), endExclusive: new Date(endExclusiveMs).toISOString() },
  sources, unexpectedQuality, alignmentIssues: dataset.report.issues, retainedAlignedDays: dataset.dayKeys.length,
  registrationPerformed: false, marketEvaluationsPerformed: 0,
}, null, 2));
if (!valid) process.exitCode = 1;
