import { Decimal } from 'decimal.js';
import {
  capitalHash, instrumentKey, sha256Hex, type CapitalLeg, type CapitalValuation,
  type InstrumentIdentity, type SpotPriceObservation,
} from '@coqui/core';
import {
  getPaperBookOrigin, listCapitalBindings, listCapitalValuations, listPaperBalances,
  listPaperDailyValuationEvidence, type Db,
} from '@coqui/storage';

import { ingestCapitalEvidence } from './capital-accounting.js';
import { capitalSourceBatch, capitalSourceEvent, capitalSourceScope } from './capital-sources.js';

interface LedgerRow {
  id: string; run_id: string; fill_id: string | null; order_id: string | null; account: string;
  asset_id: string | null; amount_usd_text: string; quantity_text: string; at: number;
}
interface FillRow { id: string; order_id: string; filled_at: number; venue_fee_text: string }
interface RecordedPosition { instrument: InstrumentIdentity; quantity: string; valueUsd: string | null }
export interface PaperCapitalQuotes {
  readonly evidenceHash: string;
  readonly observations: ReadonlyMap<string, SpotPriceObservation>;
}
const D = Decimal.clone({ precision: 60 });
function balancesAt(rows: readonly LedgerRow[], at: number): Map<string, Decimal> {
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    if (row.at > at) continue;
    const key = row.account === 'cash' ? 'USD' : ['asset', 'opening'].includes(row.account) ? row.asset_id : null;
    if (key !== null) totals.set(key, new D(totals.get(key) ?? 0).add(row.account === 'cash' ? row.amount_usd_text : row.quantity_text));
  }
  return totals;
}
function sameBalances(expected: ReadonlyMap<string, Decimal>, observed: ReadonlyMap<string, Decimal>): boolean {
  return [...new Set([...expected.keys(), ...observed.keys()])].every((key) => new D(expected.get(key) ?? 0).eq(observed.get(key) ?? 0));
}

/** Reconstruct only actual local ledger facts. Legacy price time/precision is never invented. */
export function ingestLocalPaperCapital(profileId: string, database: Db, recordedAtMs: number, quotes?: PaperCapitalQuotes): void {
  const origin = getPaperBookOrigin(profileId, database);
  if (origin === null || origin.snapshot.profileId !== profileId) return;
  const scope = capitalSourceScope(profileId, 'local_paper', 'simulation', capitalHash({ profileId, originHash: origin.contentHash }), origin.snapshot.asOfMs);
  if (listCapitalBindings(profileId, database).some((row) => row.scopeId === scope.id && row.mode === 'archived')) return;
  const ledger = database.prepare(`SELECT id,run_id,fill_id,order_id,account,asset_id,amount_usd_text,quantity_text,at
    FROM paper_ledger_entries_v3 WHERE profile_id=? ORDER BY at,id LIMIT 100001`).all(profileId) as unknown as LedgerRow[];
  const fills = database.prepare(`SELECT id,order_id,filled_at,venue_fee_text FROM paper_fills_v3 WHERE profile_id=? ORDER BY filled_at,id LIMIT 100001`)
    .all(profileId) as unknown as FillRow[];
  if (ledger.length > 100_000 || fills.length > 100_000) throw new RangeError('capital_evidence_capacity_exceeded');
  const daily = listPaperDailyValuationEvidence(profileId, database);
  const openingRows = ledger.filter((row) => row.account === 'opening');
  const originAmounts = new Map<string, Decimal>([['USD', new D(origin.snapshot.cashUsd)],
    ...origin.snapshot.balances.map((row) => [row.assetId, new D(row.quantity)] as const)]);
  const knownOrigin = openingRows.every((row) => row.run_id === `paper-origin:${origin.contentHash}` && row.at === origin.snapshot.asOfMs) &&
    sameBalances(originAmounts, balancesAt(openingRows, origin.snapshot.asOfMs));
  const groups = new Map(fills.map((fill) => [fill.id, [] as LedgerRow[]]));
  for (const row of ledger) if (row.fill_id !== null) groups.get(row.fill_id)?.push(row);
  const validFills = fills.every((fill) => {
    const rows = groups.get(fill.id)!;
    return rows.length >= 2 && rows.every((row) => row.order_id === fill.order_id && row.at === fill.filled_at &&
      ['cash', 'asset', 'venue_fee'].includes(row.account)) && rows.reduce((sum, row) => sum.add(row.amount_usd_text), new D(0)).isZero() &&
      rows.filter((row) => row.account === 'venue_fee').reduce((sum, row) => sum.add(row.amount_usd_text), new D(0)).eq(fill.venue_fee_text);
  });
  const unknownRows = ledger.filter((row) => row.account !== 'opening' &&
    (row.fill_id === null || !groups.has(row.fill_id) || !['cash', 'asset', 'venue_fee'].includes(row.account)));
  const currentBalances = new Map(listPaperBalances(profileId, database).map((row) => [row.assetId, new D(row.quantity)]));
  const reconciled = sameBalances(currentBalances, balancesAt(ledger, recordedAtMs));
  const complete = knownOrigin && validFills && unknownRows.length === 0 && reconciled;
  const batch = capitalSourceBatch({ scopeId: scope.id, source: 'local-paper-ledger-v1', requestedAtMs: recordedAtMs,
    observedAtMs: recordedAtMs, recordedAtMs, coverage: { fromMs: origin.snapshot.asOfMs, toMs: recordedAtMs,
      complete, paginationComplete: true, membershipComplete: true, reasonCodes: complete ? [] : ['paper_ledger_unreconciled'] },
    memberIdentityHashes: [scope.accountIdentityHash], evidenceRefs: [origin.contentHash, ...daily.map((row) => row.evidenceHash)],
    payload: { originHash: origin.contentHash, ledgerHash: capitalHash(ledger), fillIds: fills.map((row) => row.id),
      ledgerIds: ledger.map((row) => row.id), balancesHash: capitalHash([...currentBalances].map(([key, quantity]) => [key, quantity.toFixed()])) },
  });
  const originLegs: CapitalLeg[] = [
    { asset: 'USD', quantity: origin.snapshot.cashUsd, role: 'cash', valueUsd: origin.snapshot.cashUsd, valuationRef: origin.contentHash },
    ...origin.snapshot.balances.map((row) => ({ asset: row.assetId, quantity: row.quantity, role: 'asset' as const,
      valueUsd: row.valueUsd, valuationRef: origin.contentHash })),
  ];
  const originValue = originLegs.reduce((sum, row) => sum.add(row.valueUsd!), new D(0)).toFixed();
  const opening: CapitalValuation = { id: capitalHash({ scopeId: scope.id, originHash: origin.contentHash }),
    scopeId: scope.id, sourceBatchId: batch.id, replacesId: null, atMs: origin.snapshot.asOfMs, sequence: 0,
    observedAtMs: origin.snapshot.asOfMs, equityUsd: originValue, cashUsd: origin.snapshot.cashUsd, legs: originLegs,
    verified: knownOrigin, missingComponents: knownOrigin ? [] : ['paper_origin_unreconciled'], evidenceRefs: [origin.contentHash] };
  const previous = listCapitalBindings(profileId, database).some((row) => row.scopeId === scope.id)
    ? listCapitalValuations(scope.id, database) : [];
  const valuations: CapitalValuation[] = [opening];
  for (const row of daily) {
    if (row.capturedAt < opening.atMs || previous.some((value) => value.evidenceRefs.includes(row.evidenceHash))) continue;
    const contentHash = sha256Hex(JSON.stringify({ profileId: row.profileId, dayUtc: row.dayUtc, capturedAt: row.capturedAt,
      cashUsd: row.cashUsd, equityUsd: row.equityUsd, benchmarkUsd: row.benchmarkUsd, unpricedCount: row.unpricedCount,
      positionsJson: row.positionsJson, provenanceJson: row.provenanceJson }));
    let positions: RecordedPosition[];
    try { positions = JSON.parse(row.positionsJson) as RecordedPosition[]; }
    catch { positions = []; }
    const positive = positions.filter((position) => new D(position.quantity).gt(0));
    const actualQuotes = quotes?.evidenceHash === row.evidenceHash ? quotes.observations : null;
    const times = positive.map((position) => actualQuotes?.get(instrumentKey(position.instrument))?.observedAtMs ?? null);
    const atMs = times.length === 0 ? row.capturedAt : times.every((time) => time !== null && time === times[0]) ? times[0]! : row.capturedAt;
    const timeVerified = times.every((time) => time !== null && time === atMs) && atMs >= opening.atMs && atMs <= recordedAtMs;
    const seen = new Map<string, Decimal>([['USD', new D(row.cashUsd)], ...positions.map((position) => [instrumentKey(position.instrument), new D(position.quantity)] as const)]);
    const balanced = sameBalances(balancesAt(ledger, atMs), seen);
    const missing = [...(!complete || !balanced ? ['paper_ledger_unreconciled'] : []),
      ...(!timeVerified ? ['valuation_time_unverified'] : []), ...(contentHash !== row.evidenceHash ? ['valuation_hash_invalid'] : []),
      ...(row.unpricedCount > 0 || row.equityUsd === null ? ['prices_incomplete'] : [])];
    const legs: CapitalLeg[] = [{ asset: 'USD', quantity: row.cashUsd, role: 'cash', valueUsd: row.cashUsd, valuationRef: row.evidenceHash },
      ...positions.map((position) => {
        const quote = actualQuotes?.get(instrumentKey(position.instrument));
        return { asset: instrumentKey(position.instrument), quantity: position.quantity, role: 'asset' as const,
          valueUsd: quote === undefined ? position.valueUsd : new D(position.quantity).mul(quote.priceUsd).toFixed(),
          valuationRef: quote === undefined ? row.evidenceHash : capitalHash(quote) };
      })];
    const equityUsd = missing.length === 0 ? legs.reduce((sum, leg) => sum.add(leg.valueUsd ?? 0), new D(0)).toFixed() : row.equityUsd;
    valuations.push({ id: capitalHash({ scopeId: scope.id, evidenceHash: row.evidenceHash, atMs, legs, missing }),
      scopeId: scope.id, sourceBatchId: batch.id, replacesId: null, atMs, sequence: 0, observedAtMs: recordedAtMs,
      equityUsd, cashUsd: row.cashUsd, legs, verified: missing.length === 0, missingComponents: missing, evidenceRefs: [row.evidenceHash] });
  }
  const events = fills.map((fill) => capitalSourceEvent(batch, { logicalKey: `local-paper-fill:${fill.id}`, kind: 'trade', status: 'confirmed',
    effectiveTime: { precision: 'instant', fromMs: fill.filled_at, toMs: fill.filled_at }, externalFlowUsd: '0', flowVerified: validFills,
    feeUsd: fill.venue_fee_text, reasonCodes: validFills ? [] : ['paper_ledger_unreconciled'],
    legs: groups.get(fill.id)!.map((row) => ({ asset: row.asset_id ?? 'USD', quantity: row.account === 'asset' ? row.quantity_text : row.amount_usd_text,
      role: row.account === 'cash' ? 'cash' as const : row.account === 'venue_fee' ? 'fee' as const : 'asset' as const,
      valueUsd: row.amount_usd_text, valuationRef: fill.id })) }));
  for (const row of unknownRows) events.push(capitalSourceEvent(batch, { logicalKey: `local-paper-ledger:${row.id}`, kind: 'unknown', status: 'confirmed',
    effectiveTime: { precision: 'instant', fromMs: row.at, toMs: row.at },
    legs: [{ asset: row.asset_id ?? 'USD', quantity: row.quantity_text, role: 'asset', valueUsd: row.amount_usd_text, valuationRef: row.id }] }));
  ingestCapitalEvidence({ profileId, connectionId: null, scope, batch, events, valuations,
    opening: knownOrigin ? { valuationId: opening.id, reason: 'verified_origin', historicalLimitations: ['simulated_opening_not_tax_basis'] } : null }, database);
}
