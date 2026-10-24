import { Decimal } from 'decimal.js';
import type { AlpacaPaperAccount, AlpacaPaperActivity, AlpacaPaperOrder, AlpacaPortfolioHistory } from '@coqui/adapters';
import { capitalHash, isDecimalString, sha256Hex, type CapitalValuation } from '@coqui/core';
import { listCapitalBindings, listCapitalEvents, type Db } from '@coqui/storage';

import { ingestCapitalEvidence } from './capital-accounting.js';
import { capitalSourceBatch, capitalSourceEvent, capitalSourceScope } from './capital-sources.js';
import { captureAlpacaCapitalBudget, recordBudgetCaptureFailure, type AcquiredAlpacaBudgetAsset } from './capital-budget-sources.js';

function instant(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) return null;
  const at = Date.parse(value); return Number.isSafeInteger(at) && at >= 0 ? at : null;
}
export interface AlpacaCapitalAcquisition {
  readonly budgetAssets?: readonly AcquiredAlpacaBudgetAsset[];
  readonly profileId: string; readonly connectionId: string | null; readonly expectedAccountId: string;
  readonly requestedAtMs: number; readonly observedAtMs: number; readonly account: AlpacaPaperAccount;
  readonly history: AlpacaPortfolioHistory; readonly activities: readonly AlpacaPaperActivity[];
  readonly orders: readonly AlpacaPaperOrder[]; readonly paginationComplete: boolean; readonly ordersComplete: boolean;
  readonly cashReconciled: boolean; readonly journalDetailsComplete: boolean;
}
/** Consume already-authorized GET evidence. No request, secret or order client is accepted. */
export function ingestAlpacaCapital(input: AlpacaCapitalAcquisition, database: Db): void {
  if (input.account.id !== input.expectedAccountId || input.account.currency !== 'USD' ||
    !isDecimalString(input.account.cash) || !isDecimalString(input.account.equity)) throw new TypeError('Capital broker identity mismatch.');
  const scope = capitalSourceScope(input.profileId, 'alpaca', 'paper', sha256Hex(input.account.id.toLowerCase()), input.observedAtMs);
  const existingBinding = listCapitalBindings(input.profileId, database).find((row) => row.scopeId === scope.id);
  const activities = input.activities.map((row) => ({ id: row.id, activity_type: row.activity_type,
    order_id: row.order_id ?? null, symbol: row.symbol ?? null, qty: row.qty ?? null, price: row.price ?? null,
    transaction_time: row.transaction_time ?? null, date: row.date ?? null, net_amount: row.net_amount ?? null,
    status: row.status ?? null, created_at: row.created_at ?? null, side: row.side ?? null, currency: row.currency ?? null }));
  const historyHash = capitalHash(input.history);
  const complete = input.paginationComplete && input.ordersComplete && input.cashReconciled && input.journalDetailsComplete;
  const createdAt = instant(input.account.created_at);
  const batch = capitalSourceBatch({ scopeId: scope.id, source: 'alpaca-paper-financial-v1', requestedAtMs: input.requestedAtMs,
    observedAtMs: input.observedAtMs, recordedAtMs: input.observedAtMs,
    coverage: { fromMs: createdAt, toMs: input.observedAtMs, complete: complete && createdAt !== null,
      paginationComplete: input.paginationComplete, membershipComplete: true,
      reasonCodes: [...(!input.paginationComplete ? ['activity_history_incomplete'] : []),
        ...(!input.ordersComplete ? ['order_history_capped'] : []), ...(!input.cashReconciled ? ['cash_unreconciled'] : []),
        ...(!input.journalDetailsComplete ? ['unexplained_history_cashflows'] : []), ...(createdAt === null ? ['history_start_unknown'] : [])] },
    memberIdentityHashes: [scope.accountIdentityHash], evidenceRefs: [historyHash],
    payload: { account: { identityHash: scope.accountIdentityHash, cash: input.account.cash, equity: input.account.equity, currency: 'USD' },
      history: { ...input.history }, activities, orderIds: input.orders.map((row) => row.id),
      limits: { activityPages: 20, activityPageSize: 100, orderRows: 500 },
      currentCut: 'observed_account_total_not_atomic_activity_cut' },
  });
  const orderIds = new Set(input.orders.map((row) => row.id));
  const events = input.activities.map((row) => {
    const amount = row.net_amount !== undefined && isDecimalString(row.net_amount) ? row.net_amount : null;
    const fillTime = row.activity_type === 'FILL' ? instant(row.transaction_time) : null;
    const time = fillTime === null ? { precision: 'unknown' as const, fromMs: null, toMs: null } :
      { precision: 'instant' as const, fromMs: fillTime, toMs: fillTime };
    const status = row.activity_type === 'FILL' || row.status === 'executed' ? 'confirmed' as const :
      ['canceled', 'cancelled', 'failed'].includes(row.status ?? '') ? 'failed' as const : 'pending' as const;
    const base = { logicalKey: `alpaca-activity:${row.id}`, status, effectiveTime: time };
    if (row.activity_type === 'FILL' && row.order_id && orderIds.has(row.order_id) && row.qty !== undefined &&
      row.price !== undefined && isDecimalString(row.qty) && isDecimalString(row.price) && row.symbol &&
      ['buy', 'sell'].includes(row.side ?? '') && new Decimal(row.qty).gt(0) && new Decimal(row.price).gt(0)) {
      return capitalSourceEvent(batch, { ...base, kind: 'trade', externalFlowUsd: '0', flowVerified: true,
        reasonCodes: [], feeUsd: null, legs: [{ asset: row.symbol, quantity: new Decimal(row.qty).mul(row.side === 'sell' ? -1 : 1).toFixed(),
          role: 'asset', valueUsd: new Decimal(row.qty).mul(row.price).mul(row.side === 'sell' ? -1 : 1).toFixed(), valuationRef: row.id }] });
    }
    if (['CSD', 'CSW'].includes(row.activity_type) && amount !== null && row.currency === 'USD' &&
      (row.activity_type === 'CSD' ? new Decimal(amount).gte(0) : new Decimal(amount).lte(0))) {
      return capitalSourceEvent(batch, { ...base, kind: row.activity_type === 'CSD' ? 'contribution' : 'outflow',
        externalFlowUsd: amount, flowVerified: status === 'confirmed' && row.activity_type === 'CSD',
        reasonCodes: ['financial_effective_time_unverified', ...(row.activity_type === 'CSW' ? ['net_receipt_unverified'] : [])],
        legs: [{ asset: 'USD', quantity: amount, role: 'cash', valueUsd: amount, valuationRef: row.id }] });
    }
    if (['FEE', 'CFEE', 'INT'].includes(row.activity_type) && amount !== null && row.currency === 'USD' && status === 'confirmed') {
      const income = row.activity_type === 'INT';
      const supported = income ? new Decimal(amount).gte(0) : new Decimal(amount).lte(0);
      return capitalSourceEvent(batch, { ...base, kind: income ? 'income' : 'fee', externalFlowUsd: '0', flowVerified: supported,
        feeUsd: income || row.qty !== undefined ? null : new Decimal(amount).abs().toFixed(),
        incomeUsd: income ? amount : null, reasonCodes: supported ? ['financial_effective_time_unverified'] : ['adjustment_unverified'],
        legs: [{ asset: row.qty !== undefined && row.symbol ? row.symbol : 'USD', quantity: row.qty ?? amount,
          role: income ? 'cash' : 'fee', valueUsd: row.qty === undefined ? amount : null, valuationRef: row.id }] });
    }
    return capitalSourceEvent(batch, { ...base, kind: 'unknown', legs: amount === null ? [] :
      [{ asset: row.currency ?? 'UNKNOWN', quantity: amount, role: 'cash', valueUsd: row.currency === 'USD' ? amount : null, valuationRef: row.id }],
      reasonCodes: [row.activity_type === 'JNLC' ? 'cash_journal_purpose_unverified' : 'activity_classification_unverified'] });
  });
  const valuations: CapitalValuation[] = input.history.points.filter((point) => point.atMs <= input.requestedAtMs - 86_400_000).map((point) => ({
    id: capitalHash({ scopeId: scope.id, atMs: point.atMs, equityUsd: point.equityUsd, source: 'alpaca-historical-total' }),
    scopeId: scope.id, sourceBatchId: batch.id, replacesId: null, atMs: point.atMs, sequence: 0, observedAtMs: input.observedAtMs,
    equityUsd: point.equityUsd, cashUsd: null, legs: [], verified: point.equityUsd !== null,
    missingComponents: point.equityUsd === null ? ['provider_valuation_missing'] : [], evidenceRefs: [historyHash],
  }));
  valuations.push({ id: capitalHash({ scopeId: scope.id, atMs: input.observedAtMs, equityUsd: input.account.equity, source: 'alpaca-current-total' }),
    scopeId: scope.id, sourceBatchId: batch.id, replacesId: null, atMs: input.observedAtMs, sequence: 0,
    observedAtMs: input.observedAtMs, equityUsd: input.account.equity, cashUsd: input.account.cash, legs: [], verified: false,
    missingComponents: ['coherent_financial_cut_unverified'], evidenceRefs: [batch.id] });
  const prior = existingBinding ? listCapitalEvents(scope.id, database) : [];
  const candidate = valuations.find((valuation) => valuation.verified && complete &&
    events.every((event) => event.status === 'failed' || event.status === 'confirmed' &&
      (event.flowVerified && event.externalFlowUsd === '0' ||
        (prior.find((old) => old.id === event.id)?.observedAtMs ?? event.observedAtMs) <= valuation.atMs)));
  ingestCapitalEvidence({ profileId: input.profileId, connectionId: input.connectionId, scope, batch, events, valuations,
    opening: candidate ? { valuationId: candidate.id, reason: 'forward_tracking', historicalLimitations: ['earlier_account_performance_unavailable'] } : null }, database);
  try { captureAlpacaCapitalBudget(scope.id, input.account, input.requestedAtMs, batch.id, database, input.budgetAssets, input.profileId); }
  catch { recordBudgetCaptureFailure(scope.id, input.observedAtMs, database); }
}
