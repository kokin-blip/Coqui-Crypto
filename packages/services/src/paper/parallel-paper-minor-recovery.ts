import { Decimal } from 'decimal.js';
import { HOURLY_EXECUTION_V1 } from '@coqui/core';
import type { createAlpacaPaperClient } from '@coqui/adapters';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import { parallelQuotes } from './parallel-paper-intraday.js';
import { validateParallelPositions } from './parallel-paper-recovery.js';
import { paperPositionFingerprint } from './parallel-paper-resolution.js';
import { ParallelReconciliationError } from './parallel-paper-utils.js';

/** Owner-authorized recovery policy for small, fee-shaped discrepancies in paper only. */
export async function reconcilePaperPositionEvidence(input: {
  experiment: ParallelPaperExperiment; client: ReturnType<typeof createAlpacaPaperClient>;
  events(): readonly ParallelPaperEvent[]; now(): number;
  allowMinorResolution: boolean; fullAudit(): Promise<void>;
  append(kind: string, key: string, detail: Record<string, unknown>): void;
}): Promise<void> {
  const observe = (positions: readonly { symbol: string; quantity: string }[]) => input.append('broker_position_snapshot',
    `positions:${input.events().length}`, { accountId: input.experiment.alpacaAccountId, positions, observedAtMs: input.now() });
  try { await validateParallelPositions(input.client, input.events(), observe); return; }
  catch (error) {
    if (!input.allowMinorResolution || !(error instanceof ParallelReconciliationError) || error.positionDifferences.length === 0) throw error;
  }
  await input.fullAudit();
  // Always classify against the original ledger, never against a prior exception allowance.
  const events = input.events().filter((event) => event.kind !== 'paper_position_resolution');
  let mismatch: ParallelReconciliationError;
  try { await validateParallelPositions(input.client, events, observe); return; }
  catch (error) {
    if (!(error instanceof ParallelReconciliationError) || error.positionDifferences.length === 0) throw error;
    mismatch = error;
  }
  const feeTimes = events.filter((event) => event.kind === 'broker_activity_metadata' &&
    ['CFEE', 'FEE'].includes(String(event.detail['activityType']))).map((event) =>
    typeof event.detail['createdAt'] === 'string' ? Date.parse(event.detail['createdAt']) : NaN).filter(Number.isFinite);
  if (!feeTimes.length) throw mismatch;
  const lastFeeCreated = Math.max(...feeTimes);
  if (lastFeeCreated > input.now()) throw mismatch;
  const symbols = mismatch.positionDifferences.map(row => row.symbol);
  if (symbols.some(symbol => !['BTCUSD', 'ETHUSD', 'LTCUSD'].includes(symbol))) throw mismatch;
  const [rawQuotes, account] = await Promise.all([input.client.latestCryptoQuotes(symbols.map(symbol => `${symbol.slice(0, -3)}/USD`)), input.client.account()]);
  const quotes = parallelQuotes(rawQuotes, input.now(), symbols);
  if (account.id !== input.experiment.alpacaAccountId || account.currency !== 'USD' ||
      !['ACTIVE', 'PAPER_ONLY'].includes(account.status) || account.account_blocked || account.trading_blocked) throw mismatch;
  const equity = new Decimal(account.equity);
  if (!equity.isFinite() || equity.lte(0)) throw mismatch;
  let total = new Decimal(0);
  for (const difference of mismatch.positionDifferences) {
    if (!['BTCUSD', 'ETHUSD', 'LTCUSD'].includes(difference.symbol)) throw mismatch;
    const residual = new Decimal(difference.differenceQty), expected = new Decimal(difference.expectedQty);
    if (!residual.isFinite() || residual.gte(0) || expected.lte(0) || new Decimal(difference.observedQty).lt(0)) throw mismatch;
    const pendingBuys = events.filter((event) => event.kind === 'external_fill' &&
      String(event.detail['symbol']).replaceAll('/', '') === difference.symbol &&
      Date.parse(String(event.detail['at'])) > Math.max(lastFeeCreated, input.experiment.startedAt - 1) &&
      events.some((order) => order.kind === 'external_order' && order.detail['orderId'] === event.detail['orderId'] && order.detail['side'] === 'buy'));
    if (!pendingBuys.length) throw mismatch;
    const candidateFee = pendingBuys.reduce((sum, fill) => sum.plus(String(fill.detail['quantity'])), new Decimal(0))
      .mul(String(HOURLY_EXECUTION_V1.takerFeeRate));
    // This rounding band classifies evidence only. The accepted broker quantity stays exact.
    const roundingBand = new Decimal('0.000000003').mul(pendingBuys.length);
    if (residual.abs().minus(candidateFee).abs().gt(roundingBand)) throw mismatch;
    total = total.plus(residual.abs().mul(quotes.sides[difference.symbol]!.ask));
  }
  if (total.gt(25) || total.gt(equity.mul('0.0005'))) throw mismatch;
  const fingerprint = paperPositionFingerprint(input.events());
  input.append('paper_position_resolution', `paper-resolution:${input.events().length}`, {
    scope: 'paper_only', policy: 'fee_shaped_minor_v1', accountId: input.experiment.alpacaAccountId,
    ledgerFingerprint: fingerprint, positionDifferences: mismatch.positionDifferences,
    observedValueUsd: total.toString(), feeAttribution: 'unconfirmed', recordedFillsAndFeesChanged: false });
  // A racing position change must still block the recovery, even after recording the candidate.
  await validateParallelPositions(input.client, input.events(), observe);
}
