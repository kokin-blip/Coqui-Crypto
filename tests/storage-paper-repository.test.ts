import { describe, expect, it } from 'vitest';

import {
  decimal,
  instrumentKey,
  paperFillLedgerEntries,
  type InstrumentIdentity,
  type PaperFill,
  type PaperOrder,
  type ProductRuleSnapshot,
} from '@coqui/core';
import {
  appendPaperOrderEvent,
  bootstrapPaperBalances,
  commitPaperFill,
  getPaperOrder,
  listPaperBalances,
  openDatabase,
  recoverInterruptedPaperOrders,
  savePaperOrder,
  saveProductRuleSnapshot,
} from '../packages/storage/src/index.js';

const instrument: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};

const rules: ProductRuleSnapshot = {
  id: 'rules-1', instrument, status: 'online', tradingDisabled: false,
  cancelOnly: false, limitOnly: false, postOnly: false, viewOnly: false,
  baseIncrement: '0.00000001', quoteIncrement: '0.01', priceIncrement: '0.01',
  baseMinSize: '0.00000001', baseMaxSize: null, quoteMinSize: '1',
  quoteMaxSize: null, source: 'coinbase', retrievedAt: 10, responseHash: 'rules-hash',
};

function order(id: string, profileId = 'family-a'): PaperOrder {
  return {
    id, profileId, runId: `run-${id}`, instrument, side: 'buy',
    requestedQuantity: decimal('0.1'), requestedNotional: decimal('10'),
    state: 'proposed', productRuleSnapshotId: rules.id,
    decisionSnapshotHash: `decision-${id}`, reason: null, createdAt: 20, updatedAt: 20,
  };
}

function transition(value: PaperOrder, state: PaperOrder['state'], at: number): PaperOrder {
  return { ...value, state, updatedAt: at };
}

describe('paper execution repository', () => {
  it('preserves immutable order identity and legal OMS transitions', () => {
    const database = openDatabase(':memory:');
    expect(saveProductRuleSnapshot(rules, database)).toBe(true);
    const proposed = order('order-1');
    savePaperOrder(proposed, database);
    const initialEvent = {
      id: 'event-0', orderId: proposed.id, profileId: proposed.profileId,
      sequence: 0, state: 'proposed', at: 20, detailJson: '{"paperOnly":true}',
    } as const;
    expect(appendPaperOrderEvent(initialEvent, database)).toBe(true);
    expect(appendPaperOrderEvent(initialEvent, database)).toBe(false);
    expect(() => appendPaperOrderEvent({ ...initialEvent, detailJson: '{}' }, database))
      .toThrow('identity cannot change');

    const approved = transition(proposed, 'risk_approved', 21);
    savePaperOrder(approved, database);
    expect(getPaperOrder(proposed.id, database)).toEqual(approved);
    expect(() => savePaperOrder({ ...approved, requestedNotional: decimal('11') }, database))
      .toThrow('identity cannot change');
    expect(() => savePaperOrder(transition(approved, 'filled', 22), database))
      .toThrow('Illegal paper order transition');
    database.close();
  });

  it('commits a balanced fill and exact balances atomically and idempotently', () => {
    const database = openDatabase(':memory:');
    const assetId = instrumentKey(instrument);
    expect(bootstrapPaperBalances('family-a', [
      { assetId: 'USD', quantity: '1000' },
      { assetId, quantity: '0' },
    ], 'opening-run', 1, database)).toBe('created');
    expect(bootstrapPaperBalances('family-a', [], 'ignored', 2, database)).toBe('exists');

    let current = order('fill-order');
    savePaperOrder(current, database);
    for (const [state, at] of [
      ['risk_approved', 21], ['submission_pending', 22], ['submitted', 23],
    ] as const) {
      current = transition(current, state, at);
      savePaperOrder(current, database);
    }
    const fill: PaperFill = {
      id: 'fill-1', orderId: current.id, profileId: current.profileId,
      quantity: decimal('0.1'), executionPrice: decimal('100'), notional: decimal('10'),
      venueFee: decimal('1'), spreadCost: decimal('0'), slippageCost: decimal('0'),
      impactCost: decimal('0'), filledAt: 30, marketSnapshotHash: 'market-hash',
    };
    const entries = paperFillLedgerEntries({
      instrument, side: 'buy', quantity: '0.1', executionPrice: '100', venueFee: '1',
    });
    expect(commitPaperFill(fill, current.runId, entries, database)).toBe(true);
    expect(commitPaperFill(fill, current.runId, entries, database)).toBe(false);
    expect(() => commitPaperFill({ ...fill, venueFee: decimal('2') }, current.runId, entries, database))
      .toThrow('identity cannot change');
    expect(listPaperBalances('family-a', database)).toEqual([
      { profileId: 'family-a', assetId: 'USD', quantity: '989', updatedAt: 30 },
      { profileId: 'family-a', assetId, quantity: '0.1', updatedAt: 30 },
    ]);
    expect(listPaperBalances('family-b', database)).toEqual([]);
    database.close();
  });

  it('rolls back an unbalanced fill without inserting it', () => {
    const database = openDatabase(':memory:');
    const proposed = order('bad-fill');
    savePaperOrder(proposed, database);
    const submitted = transition(transition(transition(
      proposed, 'risk_approved', 21), 'submission_pending', 22), 'submitted', 23);
    savePaperOrder(transition(proposed, 'risk_approved', 21), database);
    savePaperOrder(transition(transition(proposed, 'risk_approved', 21), 'submission_pending', 22), database);
    savePaperOrder(submitted, database);
    const fill: PaperFill = {
      id: 'bad-fill-1', orderId: proposed.id, profileId: proposed.profileId,
      quantity: decimal('0.1'), executionPrice: decimal('100'), notional: decimal('10'),
      venueFee: decimal('0'), spreadCost: decimal('0'), slippageCost: decimal('0'),
      impactCost: decimal('0'), filledAt: 30, marketSnapshotHash: 'market-hash',
    };
    expect(() => commitPaperFill(fill, proposed.runId, [{
      account: 'cash', instrument: null, amountUsd: decimal('-10'), quantity: decimal('0'),
    }], database)).toThrow('not balanced');
    expect(database.prepare('SELECT COUNT(*) AS count FROM paper_fills_v3').get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('fails ambiguous restart recovery closed as unknown', () => {
    const database = openDatabase(':memory:');
    const untouched = order('untouched');
    savePaperOrder(untouched, database);
    const ambiguous = order('ambiguous');
    savePaperOrder(ambiguous, database);
    savePaperOrder(transition(ambiguous, 'risk_approved', 21), database);
    savePaperOrder(transition(transition(ambiguous, 'risk_approved', 21), 'submission_pending', 22), database);
    savePaperOrder(transition(transition(transition(
      ambiguous, 'risk_approved', 21), 'submission_pending', 22), 'submitted', 23), database);

    expect(recoverInterruptedPaperOrders('family-a', 40, database))
      .toEqual({ reconciled: 1, blocked: 1 });
    expect(getPaperOrder('untouched', database)?.state).toBe('cancelled');
    expect(getPaperOrder('ambiguous', database)?.state).toBe('unknown');
    database.close();
  });
});
