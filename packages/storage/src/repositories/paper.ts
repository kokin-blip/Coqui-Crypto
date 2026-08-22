import { Decimal } from 'decimal.js';
import {
  canTransitionPaperOrder,
  decimal,
  instrumentKey,
  nonNegativeDecimal,
  type InstrumentIdentity,
  type InstrumentKey,
  type PaperFill,
  type PaperLedgerEntry,
  type PaperOrder,
  type PaperOrderEvent,
  type PaperOrderState,
  type ProductRuleSnapshot,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export interface PaperBalance {
  profileId: string;
  assetId: 'USD' | InstrumentKey;
  quantity: string;
  updatedAt: number;
}

interface OrderRow {
  id: string;
  profile_id: string;
  run_id: string;
  product_id: string;
  canonical_asset_id: string;
  side: 'buy' | 'sell';
  requested_quantity_text: string;
  requested_notional_text: string;
  state: PaperOrderState;
  product_rule_snapshot_id: string;
  decision_snapshot_hash: string;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

function canonicalInstrument(key: string, productId: string): InstrumentIdentity {
  if (key !== `coinbase|spot|${productId}`) {
    throw new Error(`Invalid canonical paper instrument identity: ${key}.`);
  }
  return { venue: 'coinbase', productId, productType: 'spot' };
}

function orderFromRow(row: OrderRow): PaperOrder {
  return {
    id: row.id,
    profileId: row.profile_id,
    runId: row.run_id,
    instrument: canonicalInstrument(row.canonical_asset_id, row.product_id),
    side: row.side,
    requestedQuantity: nonNegativeDecimal(row.requested_quantity_text),
    requestedNotional: nonNegativeDecimal(row.requested_notional_text),
    state: row.state,
    productRuleSnapshotId: row.product_rule_snapshot_id,
    decisionSnapshotHash: row.decision_snapshot_hash,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveProductRuleSnapshot(rule: ProductRuleSnapshot, database: Db): boolean {
  if (rule.instrument.venue !== 'coinbase' || rule.instrument.productType !== 'spot') {
    throw new Error('Paper product rules must identify a Coinbase spot product.');
  }
  for (const value of [
    rule.baseIncrement, rule.quoteIncrement, rule.priceIncrement, rule.baseMinSize,
    rule.quoteMinSize, rule.baseMaxSize, rule.quoteMaxSize,
  ]) if (value !== null) nonNegativeDecimal(value);
  return database.prepare(
    `INSERT OR IGNORE INTO paper_product_rule_snapshots_v3
     (id, product_id, product_type, status, trading_disabled, cancel_only, limit_only,
      post_only, view_only, base_increment_text, quote_increment_text,
      price_increment_text, base_min_size_text, base_max_size_text,
      quote_min_size_text, quote_max_size_text, source, retrieved_at, response_hash)
     VALUES
     (@id, @productId, @productType, @status, @tradingDisabled, @cancelOnly, @limitOnly,
      @postOnly, @viewOnly, @baseIncrement, @quoteIncrement, @priceIncrement,
      @baseMinSize, @baseMaxSize, @quoteMinSize, @quoteMaxSize, @source,
      @retrievedAt, @responseHash)`,
  ).run({
    id: rule.id,
    productId: rule.instrument.productId,
    productType: rule.instrument.productType,
    status: rule.status,
    tradingDisabled: Number(rule.tradingDisabled),
    cancelOnly: Number(rule.cancelOnly),
    limitOnly: Number(rule.limitOnly),
    postOnly: Number(rule.postOnly),
    viewOnly: Number(rule.viewOnly),
    baseIncrement: rule.baseIncrement,
    quoteIncrement: rule.quoteIncrement,
    priceIncrement: rule.priceIncrement,
    baseMinSize: rule.baseMinSize,
    baseMaxSize: rule.baseMaxSize,
    quoteMinSize: rule.quoteMinSize,
    quoteMaxSize: rule.quoteMaxSize,
    source: rule.source,
    retrievedAt: rule.retrievedAt,
    responseHash: rule.responseHash,
  }).changes === 1;
}

export function getPaperOrder(id: string, database: Db): PaperOrder | null {
  const row = database.prepare('SELECT * FROM paper_orders_v3 WHERE id = ?').get(id);
  return row ? orderFromRow(row as unknown as OrderRow) : null;
}

export function savePaperOrder(order: PaperOrder, database: Db): void {
  const key = instrumentKey(order.instrument);
  nonNegativeDecimal(order.requestedQuantity);
  nonNegativeDecimal(order.requestedNotional);
  const existing = getPaperOrder(order.id, database);
  if (existing) {
    const immutableMatches = existing.profileId === order.profileId
      && existing.runId === order.runId
      && instrumentKey(existing.instrument) === key
      && existing.side === order.side
      && existing.requestedQuantity === order.requestedQuantity
      && existing.requestedNotional === order.requestedNotional
      && existing.productRuleSnapshotId === order.productRuleSnapshotId
      && existing.decisionSnapshotHash === order.decisionSnapshotHash
      && existing.createdAt === order.createdAt;
    if (!immutableMatches) throw new Error('A paper order identity cannot change after persistence.');
    if (existing.state !== order.state && !canTransitionPaperOrder(existing.state, order.state)) {
      throw new Error(`Illegal paper order transition: ${existing.state} -> ${order.state}.`);
    }
  } else if (order.state !== 'proposed') {
    throw new Error('A new paper order must be persisted in the proposed state.');
  }
  database.prepare(
    `INSERT INTO paper_orders_v3
     (id, profile_id, run_id, product_id, canonical_asset_id, side,
      requested_quantity_text, requested_notional_text, state,
      product_rule_snapshot_id, decision_snapshot_hash, reason, created_at, updated_at)
     VALUES (@id, @profileId, @runId, @productId, @canonicalAssetId, @side,
      @requestedQuantity, @requestedNotional, @state, @productRuleSnapshotId,
      @decisionSnapshotHash, @reason, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at`,
  ).run({
    id: order.id, profileId: order.profileId, runId: order.runId,
    productId: order.instrument.productId, canonicalAssetId: key, side: order.side,
    requestedQuantity: order.requestedQuantity, requestedNotional: order.requestedNotional,
    state: order.state, productRuleSnapshotId: order.productRuleSnapshotId,
    decisionSnapshotHash: order.decisionSnapshotHash, reason: order.reason,
    createdAt: order.createdAt, updatedAt: order.updatedAt,
  });
}

export function appendPaperOrderEvent(event: PaperOrderEvent, database: Db): boolean {
  JSON.parse(event.detailJson) as unknown;
  const prior = database.prepare('SELECT * FROM paper_order_events_v3 WHERE id = ?')
    .get(event.id) as Record<string, unknown> | undefined;
  if (prior) {
    const same = prior['order_id'] === event.orderId && prior['profile_id'] === event.profileId
      && prior['sequence'] === event.sequence && prior['state'] === event.state
      && prior['at'] === event.at && prior['detail_json'] === event.detailJson;
    if (!same) throw new Error('A paper order event identity cannot change after persistence.');
    return false;
  }
  const order = getPaperOrder(event.orderId, database);
  if (!order || order.profileId !== event.profileId) {
    throw new Error('Paper order event profile does not match its order.');
  }
  if (order.state !== event.state) throw new Error('Paper order event state must match its order.');
  const row = database.prepare(
    'SELECT MAX(sequence) AS sequence FROM paper_order_events_v3 WHERE order_id = ?',
  ).get(event.orderId) as unknown as { sequence: number | null };
  const expected = (row.sequence ?? -1) + 1;
  if (event.sequence !== expected) {
    throw new Error(`Paper order event sequence must be ${expected}.`);
  }
  return database.prepare(
    `INSERT INTO paper_order_events_v3
     (id, order_id, profile_id, sequence, state, at, detail_json)
     VALUES (@id, @orderId, @profileId, @sequence, @state, @at, @detailJson)`,
  ).run({
    id: event.id, orderId: event.orderId, profileId: event.profileId,
    sequence: event.sequence, state: event.state, at: event.at, detailJson: event.detailJson,
  }).changes === 1;
}

function validatedBalanceId(assetId: string): 'USD' | InstrumentKey {
  if (assetId === 'USD') return assetId;
  const [venue, productType, productId, extra] = assetId.split('|');
  if (venue !== 'coinbase' || productType !== 'spot' || !productId || extra !== undefined) {
    throw new Error(`Invalid paper balance identity: ${assetId}.`);
  }
  return instrumentKey({ venue, productType, productId });
}

export function listPaperBalances(profileId: string, database: Db): PaperBalance[] {
  const rows = database.prepare(
    `SELECT profile_id, asset_id, quantity_text, updated_at
     FROM paper_balances_v3 WHERE profile_id = ? ORDER BY asset_id`,
  ).all(profileId) as unknown as Array<{
    profile_id: string; asset_id: string; quantity_text: string; updated_at: number;
  }>;
  return rows.map((row) => ({
    profileId: row.profile_id,
    assetId: validatedBalanceId(row.asset_id),
    quantity: nonNegativeDecimal(row.quantity_text),
    updatedAt: row.updated_at,
  }));
}

export function bootstrapPaperBalances(
  profileId: string,
  balances: ReadonlyArray<{ assetId: 'USD' | InstrumentKey; quantity: string }>,
  runId: string,
  at: number,
  database: Db,
): 'created' | 'exists' {
  return inTransaction(database, () => {
    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM paper_balances_v3 WHERE profile_id = ?',
    ).get(profileId) as unknown as { count: number };
    if (count.count > 0) return 'exists';
    const balance = database.prepare(
      'INSERT INTO paper_balances_v3 VALUES (?, ?, ?, ?)',
    );
    const ledger = database.prepare(
      `INSERT INTO paper_ledger_entries_v3
       (id, profile_id, run_id, order_id, fill_id, account, asset_id,
        amount_usd_text, quantity_text, at)
       VALUES (?, ?, ?, NULL, NULL, 'opening', ?, '0', ?, ?)`,
    );
    for (const item of balances) {
      const assetId = validatedBalanceId(item.assetId);
      const quantity = nonNegativeDecimal(item.quantity);
      balance.run(profileId, assetId, quantity, at);
      ledger.run(`${runId}:opening:${assetId}`, profileId, runId, assetId, quantity, at);
    }
    return 'created';
  });
}

function assertLedger(entries: readonly PaperLedgerEntry[], order: PaperOrder): void {
  let total = new Decimal(0);
  const expectedInstrument = instrumentKey(order.instrument);
  for (const entry of entries) {
    decimal(entry.amountUsd);
    decimal(entry.quantity);
    total = total.add(entry.amountUsd);
    if (entry.account === 'asset' && entry.instrument !== expectedInstrument) {
      throw new Error('Paper asset posting does not match its order instrument.');
    }
    if (entry.account !== 'asset' && entry.instrument !== null) {
      throw new Error('Only asset postings may identify an instrument.');
    }
  }
  if (!total.isZero()) throw new Error('Paper fill ledger entries are not balanced.');
}

export function commitPaperFill(
  fill: PaperFill,
  runId: string,
  entries: readonly PaperLedgerEntry[],
  database: Db,
): boolean {
  return inTransaction(database, () => {
    const order = getPaperOrder(fill.orderId, database);
    if (!order || order.profileId !== fill.profileId) {
      throw new Error('Paper fill profile does not match its order.');
    }
    if (!['submitted', 'acknowledged', 'open', 'partially_filled'].includes(order.state)) {
      throw new Error(`Paper order state ${order.state} cannot accept a fill.`);
    }
    for (const value of [fill.quantity, fill.executionPrice, fill.notional, fill.venueFee,
      fill.spreadCost, fill.slippageCost, fill.impactCost]) nonNegativeDecimal(value);
    assertLedger(entries, order);
    const duplicate = database.prepare('SELECT * FROM paper_fills_v3 WHERE id = ?').get(fill.id);
    if (duplicate) {
      const row = duplicate as unknown as Record<string, unknown>;
      const same = row['order_id'] === fill.orderId && row['profile_id'] === fill.profileId
        && row['quantity_text'] === fill.quantity
        && row['execution_price_text'] === fill.executionPrice
        && row['notional_text'] === fill.notional && row['venue_fee_text'] === fill.venueFee
        && row['spread_cost_text'] === fill.spreadCost
        && row['slippage_cost_text'] === fill.slippageCost
        && row['impact_cost_text'] === fill.impactCost && row['filled_at'] === fill.filledAt
        && row['market_snapshot_hash'] === fill.marketSnapshotHash;
      if (!same) {
        throw new Error('A paper fill identity cannot change after persistence.');
      }
      return false;
    }
    database.prepare(
      `INSERT INTO paper_fills_v3
       (id, order_id, profile_id, quantity_text, execution_price_text, notional_text,
        venue_fee_text, spread_cost_text, slippage_cost_text, impact_cost_text,
        filled_at, market_snapshot_hash)
       VALUES (@id, @orderId, @profileId, @quantity, @executionPrice, @notional,
        @venueFee, @spreadCost, @slippageCost, @impactCost, @filledAt, @marketSnapshotHash)`,
    ).run({
      id: fill.id, orderId: fill.orderId, profileId: fill.profileId,
      quantity: fill.quantity, executionPrice: fill.executionPrice, notional: fill.notional,
      venueFee: fill.venueFee, spreadCost: fill.spreadCost,
      slippageCost: fill.slippageCost, impactCost: fill.impactCost,
      filledAt: fill.filledAt, marketSnapshotHash: fill.marketSnapshotHash,
    });
    const deltas = new Map<string, Decimal>();
    const ledger = database.prepare(
      `INSERT INTO paper_ledger_entries_v3
       (id, profile_id, run_id, order_id, fill_id, account, asset_id,
        amount_usd_text, quantity_text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    entries.forEach((entry, index) => {
      ledger.run(`${fill.id}:ledger:${index}`, fill.profileId, runId, fill.orderId, fill.id,
        entry.account, entry.instrument, entry.amountUsd, entry.quantity, fill.filledAt);
      const assetId = entry.account === 'cash' ? 'USD'
        : entry.account === 'asset' ? entry.instrument : null;
      const delta = entry.account === 'cash' ? entry.amountUsd : entry.quantity;
      if (assetId) deltas.set(assetId, (deltas.get(assetId) ?? new Decimal(0)).add(delta));
    });
    const current = database.prepare(
      'SELECT quantity_text FROM paper_balances_v3 WHERE profile_id = ? AND asset_id = ?',
    );
    const upsert = database.prepare(
      `INSERT INTO paper_balances_v3 VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, asset_id) DO UPDATE SET
         quantity_text = excluded.quantity_text, updated_at = excluded.updated_at`,
    );
    for (const [assetId, delta] of deltas) {
      const row = current.get(fill.profileId, assetId) as unknown as { quantity_text: string } | undefined;
      const next = new Decimal(row?.quantity_text ?? '0').add(delta);
      if (next.isNegative()) throw new Error(`Paper fill would make ${assetId} balance negative.`);
      upsert.run(fill.profileId, assetId, next.toFixed(), fill.filledAt);
    }
    return true;
  });
}

/**
 * Fills for a profile, newest first.
 *
 * Backs the reconciliation harness and the forward-evidence fill counter. The
 * table is indexed on `(profile_id, filled_at DESC)`, which is exactly this.
 */
export function listPaperFills(
  profileId: string,
  sinceMs: number,
  limit: number,
  database: Db,
): PaperFill[] {
  const bounded = Math.max(1, Math.min(5_000, Math.floor(limit)));
  const rows = database.prepare(`
    SELECT * FROM paper_fills_v3
    WHERE profile_id = ? AND filled_at >= ?
    ORDER BY filled_at DESC, id
    LIMIT ?
  `).all(profileId, sinceMs, bounded) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row['id']),
    orderId: String(row['order_id']),
    profileId: String(row['profile_id']),
    quantity: String(row['quantity_text']) as PaperFill['quantity'],
    executionPrice: String(row['execution_price_text']) as PaperFill['executionPrice'],
    notional: String(row['notional_text']) as PaperFill['notional'],
    venueFee: String(row['venue_fee_text']) as PaperFill['venueFee'],
    spreadCost: String(row['spread_cost_text']) as PaperFill['spreadCost'],
    slippageCost: String(row['slippage_cost_text']) as PaperFill['slippageCost'],
    impactCost: String(row['impact_cost_text']) as PaperFill['impactCost'],
    filledAt: Number(row['filled_at']),
    marketSnapshotHash: String(row['market_snapshot_hash']),
  }));
}

/** Forward-evidence fill counter; counts rows rather than materialising them. */
export function countPaperFills(profileId: string, sinceMs: number, database: Db): number {
  const row = database.prepare(
    'SELECT COUNT(*) AS count FROM paper_fills_v3 WHERE profile_id = ? AND filled_at >= ?',
  ).get(profileId, sinceMs) as { count: number };
  return Number(row.count);
}

export function recoverInterruptedPaperOrders(
  profileId: string,
  at: number,
  database: Db,
): { reconciled: number; blocked: number } {
  return inTransaction(database, () => {
    const rows = database.prepare(
      `SELECT * FROM paper_orders_v3 WHERE profile_id = ?
       AND state NOT IN ('risk_rejected', 'filled', 'cancelled', 'expired', 'reconciled')
       ORDER BY created_at, id`,
    ).all(profileId) as unknown as OrderRow[];
    let reconciled = 0;
    let blocked = 0;
    for (const row of rows) {
      const order = orderFromRow(row);
      const fills = database.prepare(
        'SELECT quantity_text FROM paper_fills_v3 WHERE order_id = ? ORDER BY id',
      ).all(order.id) as unknown as Array<{ quantity_text: string }>;
      const filled = fills.reduce((sum, fill) => sum.add(fill.quantity_text), new Decimal(0));
      const requested = new Decimal(order.requestedQuantity);
      const safeToCancel = filled.isZero()
        && ['proposed', 'risk_approved', 'submission_pending'].includes(order.state);
      const next: PaperOrderState = filled.eq(requested) && filled.isPositive()
        ? 'filled' : safeToCancel ? 'cancelled' : 'unknown';
      if (next === 'unknown') blocked += 1;
      else reconciled += 1;
      if (order.state === next) continue;
      if (!canTransitionPaperOrder(order.state, next)) {
        throw new Error(`Illegal recovery transition: ${order.state} -> ${next}.`);
      }
      database.prepare('UPDATE paper_orders_v3 SET state = ?, updated_at = ? WHERE id = ?')
        .run(next, at, order.id);
      const sequence = database.prepare(
        'SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM paper_order_events_v3 WHERE order_id = ?',
      ).get(order.id) as unknown as { sequence: number };
      database.prepare(
        `INSERT INTO paper_order_events_v3 VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(`${order.id}:recovery:${sequence.sequence}`, order.id, profileId, sequence.sequence,
        next, at, JSON.stringify({ paperOnly: true, recoveredAfterRestart: true,
          filledQuantity: filled.toFixed(), requestedQuantity: requested.toFixed() }));
    }
    return { reconciled, blocked };
  });
}
