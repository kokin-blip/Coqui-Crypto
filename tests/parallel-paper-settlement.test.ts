import { describe, expect, it, vi } from 'vitest';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { reconcilePaperPositionEvidence } from '../packages/services/src/paper/parallel-paper-minor-recovery.js';
import { validateParallelPositions } from '../packages/services/src/paper/parallel-paper-recovery.js';

const START = Date.parse('2026-10-20T12:00:00Z');
function fixture() {
  let now = START, qty = '0';
  const experiment = { id: 'experiment', profileId: 'main', alpacaAccountId: 'account', startedAt: START } as ParallelPaperExperiment;
  const events: ParallelPaperEvent[] = [], keys = new Set<string>();
  const append = (kind: string, key: string, detail: Record<string, unknown>) => {
    if (keys.has(key)) return;
    keys.add(key); events.push({ id: String(events.length), kind, at: now, experimentId: 'experiment', profileId: 'main', detail });
  };
  append('started', 'start', {});
  append('broker_position_snapshot', 'anchor', { accountId: 'account', positions: [], observedAtMs: now });
  append('readiness', 'clean', { operation: 'broker_reconciliation', status: 'validated', positionBasis: 'ledger' });
  const trade = (id: string, side: 'buy' | 'sell', fills: { qty: string; cumulative: string; net: string }[]) => {
    append('external_intent', `intent:${id}`, { clientOrderId: id, symbol: 'BTCUSD', side });
    append('submit_attempt', `attempt:${id}`, { clientOrderId: id });
    append('external_order', `order:${id}`, { clientOrderId: id, orderId: id, status: 'filled', symbol: 'BTCUSD', side,
      filledQty: fills.at(-1)!.cumulative });
    fills.forEach((fill, index) => {
      now += 1;
      const at = new Date(now).toISOString(), executionId = `${id}-${index}`;
      append('broker_trade_update', `stream:${executionId}`, { accountId: 'account', source: 'alpaca_paper_trade_updates',
        at, executionId, orderId: id, clientOrderId: id, symbol: 'BTCUSD', side, quantity: fill.qty,
        filledQty: fill.cumulative, price: '100', positionQty: fill.net });
      append('external_fill', `fill:${executionId}`, { activityId: `activity::${executionId}`, orderId: id,
        at, symbol: 'BTC/USD', quantity: fill.qty, price: '100' });
      qty = fill.net;
    });
    now += 1;
  };
  const client = { positions: vi.fn(async () => qty === '0' ? [] : [{ symbol: 'BTCUSD', qty, market_value: '100' }]) };
  const input = { experiment, client: client as never, events: () => events, now: () => now,
    fullAudit: vi.fn(async () => {}), append };
  trade('buy', 'buy', [{ qty: '0.6', cumulative: '0.6', net: '0.5985' }, { qty: '0.4', cumulative: '1', net: '0.9975' }]);
  return { input, events, append, trade, client, setNow: (value: number) => { now = value; },
    setQty: (value: string) => { qty = value; },
    update: () => events.find(event => event.kind === 'broker_trade_update')!.detail };
}

describe('broker execution settlement with delayed fee accounting', () => {
  it('proves exact net positions after the full audit without booking a fee or relaxing the accounting validator', async () => {
    const f = fixture();
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('broker_trade_updates');
    expect(f.input.fullAudit).toHaveBeenCalledOnce();
    const proof = f.events.find(event => event.kind === 'broker_settlement_verified')!;
    expect(proof.detail['pending']).toEqual([{ symbol: 'BTCUSD', quantity: '0.9975', unreportedDebitQty: '0.0025' }]);
    expect(f.events.some(event => ['external_fee', 'paper_position_resolution'].includes(event.kind))).toBe(false);
    await expect(validateParallelPositions(f.client as never, f.events)).rejects.toThrow('broker_positions_mismatch');
    const financialBefore = f.events.filter(event => ['external_fill', 'external_order', 'submit_attempt'].includes(event.kind));
    await reconcilePaperPositionEvidence(f.input);
    expect(f.events.filter(event => event.kind === 'broker_settlement_verified')).toHaveLength(1);
    expect(f.events.filter(event => ['external_fill', 'external_order', 'submit_attempt'].includes(event.kind))).toEqual(financialBefore);
  });
  it('uses observed quantities rather than substituting the modeled fee rate', async () => {
    const f = fixture();
    f.update()['positionQty'] = '0.599';
    f.events.findLast(event => event.kind === 'broker_trade_update')!.detail['positionQty'] = '0.998';
    f.setQty('0.998');
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('broker_trade_updates');
    expect(f.events.find(event => event.kind === 'broker_settlement_verified')!.detail['pending'])
      .toEqual([{ symbol: 'BTCUSD', quantity: '0.998', unreportedDebitQty: '0.002' }]);
  });
  it.each(['missing_stream', 'missing_baseline', 'wrong_baseline', 'legacy_allowance', 'saved_proof'])(
    'rejects a percentage-shaped gap without independent evidence: %s', async kind => {
      const f = fixture();
      if (kind === 'missing_baseline') f.events.splice(f.events.findIndex(event => event.kind === 'readiness'), 1);
      else if (kind === 'wrong_baseline') f.events.find(event => event.kind === 'broker_position_snapshot')!.detail['positions'] = [{ symbol: 'BTCUSD', quantity: '0.01' }];
      else {
        f.events.splice(f.events.findIndex(event => event.kind === 'broker_trade_update'), 1);
        if (kind !== 'missing_stream') f.append(kind === 'saved_proof' ? 'broker_settlement_verified' : 'paper_position_resolution', 'untrusted-proof', {
          basis: 'broker_trade_updates', pending: [{ symbol: 'BTCUSD', quantity: '0.9975', unreportedDebitQty: '0.0025' }] });
      }
      await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
    });
  it.each([
    ['accountId', 'other'], ['source', 'unknown'], ['clientOrderId', 'foreign'], ['orderId', 'other'],
    ['quantity', '0.59'], ['filledQty', '0.59'], ['price', '101'], ['side', 'sell'], ['symbol', 'ETHUSD'],
    ['at', 'invalid'], ['at', '2026-10-22T00:00:00Z'], ['positionQty', '0.6'], ['positionQty', '0.5984'],
  ])('blocks mismatched or incomplete execution proof: %s = %s', async (key, value) => {
    const f = fixture(); f.update()[key] = value;
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
  });
  it('rejects a changed REST quantity even inside the fee classifier rounding band', async () => {
    const f = fixture(); f.setQty('0.997499999');
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
  });
  it('rejects conflicting execution IDs and incomplete cumulative order evidence', async () => {
    const f = fixture();
    f.append('broker_trade_update', 'duplicate', { ...f.update(), positionQty: '0.5' });
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
    const partial = fixture();
    partial.events.find(event => event.kind === 'external_order')!.detail['filledQty'] = '1.1';
    await expect(reconcilePaperPositionEvidence(partial.input)).rejects.toThrow('broker_positions_mismatch');
  });
  it('continues through further buys, sells, midnight and restart using the original clean baseline', async () => {
    const f = fixture(); await reconcilePaperPositionEvidence(f.input);
    f.append('readiness', 'settlement-ready', { operation: 'broker_reconciliation', status: 'validated', positionBasis: 'broker_trade_updates' });
    f.setNow(START + 86_400_000);
    f.trade('sell', 'sell', [{ qty: '0.1', cumulative: '0.1', net: '0.8975' }]);
    f.trade('buy2', 'buy', [{ qty: '1', cumulative: '1', net: '1.895' }]);
    const restarted = { ...f.input, events: () => f.events.map(event => ({ ...event, detail: { ...event.detail } })) };
    expect(await reconcilePaperPositionEvidence(restarted)).toBe('broker_trade_updates');
    expect(f.events.findLast(event => event.kind === 'broker_settlement_verified')!.detail['pending'])
      .toEqual([{ symbol: 'BTCUSD', quantity: '1.895', unreportedDebitQty: '0.005' }]);
    f.setNow(START + 3 * 86_400_000);
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('broker_trade_updates');
  });
  it('settles partial and final published fees exactly and never deducts the fee twice', async () => {
    const f = fixture();
    f.append('external_fee', 'partial-fee', { symbol: 'BTCUSD', quantity: '-0.001', status: 'executed' });
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('broker_trade_updates');
    expect(f.events.findLast(event => event.kind === 'broker_settlement_verified')!.detail['pending'])
      .toEqual([{ symbol: 'BTCUSD', quantity: '0.9975', unreportedDebitQty: '0.0015' }]);
    f.append('external_fee', 'remaining-fee', { symbol: 'BTCUSD', quantity: '-0.0015', status: 'executed' });
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('ledger');
    expect(await reconcilePaperPositionEvidence(f.input)).toBe('ledger');
    await validateParallelPositions(f.client as never, f.events);
    expect(f.events.filter(event => event.kind === 'external_fee')).toHaveLength(2);
  });
  it('keeps network/audit failures blocked and requires fresh REST positions every time', async () => {
    const f = fixture(); f.input.fullAudit.mockRejectedValueOnce(new Error('unexpected_alpaca_activity'));
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('unexpected_alpaca_activity');
    await reconcilePaperPositionEvidence(f.input);
    f.client.positions.mockRejectedValueOnce(new Error('network_failure'));
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('network_failure');
  });
});
