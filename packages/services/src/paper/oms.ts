import {
  instrumentKey,
  paperFillLedgerEntries,
  sha256Hex,
  type Clock,
  type MarketBar,
  type PaperFill,
  type PaperOrder,
  type PaperOrderState,
  type ProductRuleSnapshot,
} from '@coqui/core';
import {
  appendPaperOrderEvent,
  commitExploratoryPaperFill,
  commitPaperFill,
  getPaperPendingExecution,
  getPaperOrder,
  getProductRuleSnapshot,
  inTransaction,
  listSubmittedPaperExecutions,
  listSubmittedExploratoryPaperExecutions,
  linkExploratoryPaperExecution,
  savePaperPendingExecution,
  settlePaperPendingExecution,
  saveProductRuleSnapshot,
  savePaperOrder,
  type Db,
} from '@coqui/storage';

import { isApproved, type ApprovedExecution } from './execution-gate.js';
import { availableForPaperIntentUsd } from './oms-book.js';
import {
  isFilled,
  paperCostModelHash,
  selectExecutionBar,
  simulateFill,
  type VenueOutcome,
} from './venue.js';

/**
 * The paper order-management system.
 *
 * It accepts **only** an `ApprovedExecution` — a value branded with a symbol
 * that `execution-gate.ts` does not export. That is what makes
 * `ARCHITECTURE.md` §6's "there is no bypass" structural rather than
 * procedural: an intent that skipped the gate chain cannot be handed to this,
 * because it does not typecheck.
 *
 * One state machine, driven through the transitions `canTransitionPaperOrder`
 * permits, with an event appended at every step. `savePaperOrder` refuses an
 * illegal transition and freezes order identity, and `commitPaperFill` writes
 * the fill, its ledger legs and the balance changes inside one transaction.
 */

export type OmsIssueCode =
  | 'no_product_rules'
  | 'no_bars'
  | 'venue_refused'
  | 'inconsistent_fill'
  | 'storage_rejected';

export interface OmsIssue {
  readonly path: readonly string[];
  readonly code: OmsIssueCode;
  /** A stable venue reason where one exists; never a raw error message. */
  readonly detail: string | null;
}

export interface OmsOrderResult {
  readonly productId: string;
  readonly side: 'buy' | 'sell';
  readonly orderId: string;
  readonly finalState: PaperOrderState;
  readonly filledQuantity: string | null;
  readonly issue: OmsIssue | null;
}

export interface OmsRunResult {
  readonly runId: string;
  readonly profileId: string;
  readonly orders: readonly OmsOrderResult[];
  readonly filledCount: number;
  readonly refusedCount: number;
}

export interface PaperPendingPlacementContext {
  readonly decisionId: string;
  readonly requiredExecutionBarStartMs: number;
  readonly costModelHash: string;
}

export interface PaperPendingSubmitResult {
  readonly submittedCount: number;
  readonly refusedCount: number;
  readonly orderIds: readonly string[];
}

export interface PaperPendingSettlementResult {
  readonly filledCount: number;
  readonly expiredCount: number;
  readonly pendingCount: number;
  readonly decisionIds: readonly string[];
  readonly outcomes: readonly {
    readonly decisionId: string;
    readonly orderId: string;
    readonly disposition: 'filled' | 'expired';
    readonly atMs: number;
  }[];
}

export interface PaperMarketData {
  /** Every known bar for an instrument, ascending. The venue picks the fill bar. */
  bars(instrumentKey: string): readonly MarketBar[];
  rules(instrumentKey: string): ProductRuleSnapshot | null;
}

export interface PaperOmsDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly market: PaperMarketData;
  /**
   * Receives a thrown error with full detail so it reaches the log.
   *
   * Without this the catch below turns every storage failure into an opaque
   * `storage_rejected`, which is exactly as unhelpful as the raw error would be
   * dangerous on a surface. The detail goes here; the wire gets a stable code.
   */
  readonly onUnexpectedError?: (productId: string, error: unknown) => void;
}

function issue(path: readonly string[], code: OmsIssueCode, detail: string | null = null): OmsIssue {
  return { path, code, detail };
}

/** Deterministic per (run, product, side) — the schema's uniqueness key. */
function orderIdFor(approval: ApprovedExecution, productId: string, side: string): string {
  return sha256Hex(`${approval.profileId}:${approval.campaignId ?? 'legacy'}:${approval.runId}:${productId}:${side}`);
}

/**
 * Checks `assertLedger` does not perform.
 *
 * Storage verifies the legs sum to zero and that only asset legs name an
 * instrument. It does **not** verify that the notional equals price × quantity,
 * so a fill whose arithmetic disagrees with itself would persist as a balanced
 * ledger describing a trade that never happened.
 */
function fillIsSelfConsistent(outcome: Extract<VenueOutcome, { filled: true }>): boolean {
  const expected = Number(outcome.quantity) * Number(outcome.executionPrice);
  const actual = Number(outcome.notional);
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-9);
  return Math.abs(actual - expected) <= tolerance;
}

export class PaperOmsService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #market: PaperMarketData;
  readonly #onUnexpectedError: (productId: string, error: unknown) => void;

  constructor(dependencies: PaperOmsDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#market = dependencies.market;
    this.#onUnexpectedError = dependencies.onUnexpectedError ?? (() => {});
  }

  /**
   * Place and settle every approved intent.
   *
   * Each order is independent: one refusal does not abandon the rest, because a
   * product delisted overnight must not stop the others from trading. Every
   * outcome is recorded, refusals included — a run that placed nothing is
   * evidence, not an absence of evidence.
   */
  execute(approval: ApprovedExecution): OmsRunResult {
    const orders: OmsOrderResult[] = [];

    for (const intent of approval.intents) {
      orders.push(this.#executeOne(approval, intent));
    }

    return {
      runId: approval.runId,
      profileId: approval.profileId,
      orders: Object.freeze(orders),
      filledCount: orders.filter((order) => order.finalState === 'filled').length,
      refusedCount: orders.filter((order) => order.issue !== null).length,
    };
  }

  /** Persist approved orders for an exact future bar without pricing or filling them. */
  submitPending(
    approval: ApprovedExecution,
    context: PaperPendingPlacementContext,
  ): PaperPendingSubmitResult {
    const orderIds: string[] = [];
    let refusedCount = 0;
    for (const intent of approval.intents) {
      const key = instrumentKey(intent.asset.instrument);
      const rules = this.#market.rules(key);
      if (rules === null || instrumentKey(rules.instrument) !== key) {
        refusedCount += 1;
        continue;
      }
      const orderId = orderIdFor(approval, intent.asset.instrument.productId, intent.side);
      try {
        inTransaction(this.#database, () => {
          const pendingId = sha256Hex(`pending:${orderId}`);
          const prior = getPaperPendingExecution(pendingId, this.#database);
          if (prior !== null) {
            if (prior.profileId !== approval.profileId || prior.decisionId !== context.decisionId ||
                prior.requiredExecutionBarStartMs !== context.requiredExecutionBarStartMs ||
                prior.costModelHash !== context.costModelHash) {
              throw new Error('Pending execution retry changed immutable context.');
            }
            if (prior.status !== 'submitted') {
              throw new Error('Pending execution retry is already terminal.');
            }
            return;
          }
          saveProductRuleSnapshot(rules, this.#database);
          const order: PaperOrder = {
            id: orderId, profileId: approval.profileId, runId: approval.runId,
            instrument: intent.asset.instrument, side: intent.side,
            requestedQuantity: '0' as PaperOrder['requestedQuantity'],
            requestedNotional: String(intent.amountUsd) as PaperOrder['requestedNotional'],
            state: 'proposed', productRuleSnapshotId: rules.id,
            decisionSnapshotHash: context.decisionId, reason: null,
            createdAt: this.#clock.nowMs(), updatedAt: this.#clock.nowMs(),
          };
          savePaperOrder(order, this.#database);
          this.#event(order, 'proposed', 0, order.createdAt, {
            gatesPassed: approval.gatesPassed, admissionMode: approval.admissionMode,
            campaignId: approval.campaignId, profitabilityAssessment: approval.profitabilityAssessment,
            evidenceEligibility: approval.evidenceEligibility,
          });
          let sequence = 1;
          for (const state of ['risk_approved', 'submission_pending', 'submitted'] as const) {
            this.#advance(order, state, sequence++, order.createdAt, null);
          }
          savePaperPendingExecution({
            schemaVersion: 1,
            id: pendingId,
            profileId: approval.profileId,
            decisionId: context.decisionId,
            orderId,
            instrument: intent.asset.instrument,
            symbol: intent.asset.symbol,
            side: intent.side,
            requestedUsd: String(intent.amountUsd),
            requiredExecutionBarStartMs: context.requiredExecutionBarStartMs,
            productRuleSnapshotId: rules.id,
            costModelHash: context.costModelHash,
            status: 'submitted',
            submittedAtMs: order.createdAt,
            settledAtMs: null,
          }, this.#database);
          if (approval.campaignId !== null) {
            linkExploratoryPaperExecution({ campaignId: approval.campaignId,
              profileId: approval.profileId, decisionId: context.decisionId,
              orderId, pendingId, createdAtMs: order.createdAt }, this.#database);
          }
        });
        orderIds.push(orderId);
      } catch (error) {
        this.#onUnexpectedError(intent.asset.instrument.productId, error);
        refusedCount += 1;
      }
    }
    return Object.freeze({ submittedCount: orderIds.length, refusedCount, orderIds });
  }

  /** Settle only the recorded execution interval; never substitute a later bar. */
  settlePending(profileId: string, campaignId: string | null = null): PaperPendingSettlementResult {
    let filledCount = 0;
    let expiredCount = 0;
    let pendingCount = 0;
    const decisionIds = new Set<string>();
    const outcomes: Array<{
      decisionId: string;
      orderId: string;
      disposition: 'filled' | 'expired';
      atMs: number;
    }> = [];
    const pending = [...(campaignId === null
      ? listSubmittedPaperExecutions(profileId, this.#database)
      : listSubmittedExploratoryPaperExecutions(campaignId, profileId, this.#database))].sort((left, right) =>
      left.side !== right.side ? left.side === 'sell' ? -1 : 1 : left.id < right.id ? -1 : 1);
    inTransaction(this.#database, () => { for (const item of pending) {
      const bars = this.#market.bars(instrumentKey(item.instrument));
      const exact = bars.find((bar) => bar.startTimeMs === item.requiredExecutionBarStartMs);
      if (exact === undefined) {
        if (bars.some((bar) => bar.isComplete && bar.startTimeMs > item.requiredExecutionBarStartMs)) {
          const order = getPaperOrder(item.orderId, this.#database);
          if (order === null) throw new Error('Pending execution order is missing.');
          const atMs = this.#clock.nowMs();
          this.#advance(order, 'expired', 4, atMs, 'required_execution_bar_missing');
          settlePaperPendingExecution(item.id, 'expired', atMs, this.#database);
          expiredCount += 1;
          decisionIds.add(item.decisionId);
          outcomes.push({ decisionId: item.decisionId, orderId: item.orderId,
            disposition: 'expired', atMs });
        } else pendingCount += 1;
        continue;
      }
      if (!exact.isComplete) { pendingCount += 1; continue; }
      const rules = getProductRuleSnapshot(item.productRuleSnapshotId, this.#database);
      if (rules === null || item.costModelHash !== paperCostModelHash()) {
        const order = getPaperOrder(item.orderId, this.#database);
        if (order === null) throw new Error('Pending execution order is missing.');
        const atMs = this.#clock.nowMs();
        this.#advance(order, 'expired', 4, atMs, 'bound_snapshot_unavailable');
        settlePaperPendingExecution(item.id, 'expired', atMs, this.#database);
        expiredCount += 1;
        decisionIds.add(item.decisionId);
        outcomes.push({ decisionId: item.decisionId, orderId: item.orderId,
          disposition: 'expired', atMs });
        continue;
      }
      const outcome = simulateFill({
        instrument: item.instrument, symbol: item.symbol, side: item.side,
        requestedUsd: item.requestedUsd,
        availableCashUsd: availableForPaperIntentUsd(
          { profileId, campaignId },
          item.side,
          item.instrument,
          String(exact.open),
          this.#database,
        ),
        rules, bars: [exact], decidedAtMs: item.requiredExecutionBarStartMs,
      });
      const order = getPaperOrder(item.orderId, this.#database);
      if (order === null) throw new Error('Pending execution order is missing.');
      if (!isFilled(outcome) || !fillIsSelfConsistent(outcome)) {
        const atMs = this.#clock.nowMs();
        const reason = isFilled(outcome) ? 'inconsistent_fill' : outcome.code;
        this.#advance(order, 'expired', 4, atMs, reason);
        settlePaperPendingExecution(item.id, 'expired', atMs, this.#database);
        expiredCount += 1;
        decisionIds.add(item.decisionId);
        outcomes.push({ decisionId: item.decisionId, orderId: item.orderId,
          disposition: 'expired', atMs });
        continue;
      }
      const fill: PaperFill = {
        id: sha256Hex(`${item.orderId}:${exact.startTimeMs}`), orderId: item.orderId,
        profileId, quantity: outcome.quantity as PaperFill['quantity'],
        executionPrice: outcome.executionPrice as PaperFill['executionPrice'],
        notional: outcome.notional as PaperFill['notional'], venueFee: outcome.venueFee as PaperFill['venueFee'],
        spreadCost: outcome.spreadCost as PaperFill['spreadCost'],
        slippageCost: outcome.slippageCost as PaperFill['slippageCost'],
        impactCost: outcome.impactCost as PaperFill['impactCost'], filledAt: outcome.filledAtMs,
        marketSnapshotHash: sha256Hex(`${instrumentKey(item.instrument)}:${exact.startTimeMs}:${exact.open}`),
      };
      const ledgerEntries = paperFillLedgerEntries({
        instrument: item.instrument, side: item.side, quantity: outcome.quantity,
        executionPrice: outcome.executionPrice, venueFee: outcome.venueFee,
      });
      if (campaignId === null) commitPaperFill(fill, order.runId, ledgerEntries, this.#database);
      else commitExploratoryPaperFill(campaignId, fill, order.runId, ledgerEntries, this.#database);
      this.#advance(order, 'filled', 4, outcome.filledAtMs, null);
      settlePaperPendingExecution(item.id, 'filled', outcome.filledAtMs, this.#database);
      filledCount += 1;
      decisionIds.add(item.decisionId);
      outcomes.push({ decisionId: item.decisionId, orderId: item.orderId,
        disposition: 'filled', atMs: outcome.filledAtMs });
    }});
    return Object.freeze({
      filledCount, expiredCount, pendingCount, decisionIds: Object.freeze([...decisionIds]),
      outcomes: Object.freeze(outcomes),
    });
  }

  #executeOne(
    approval: ApprovedExecution,
    intent: ApprovedExecution['intents'][number],
  ): OmsOrderResult {
    const instrument = intent.asset.instrument;
    const key = instrumentKey(instrument);
    const productId = instrument.productId;
    const orderId = orderIdFor(approval, productId, intent.side);
    const now = this.#clock.nowMs();

    const rules = this.#market.rules(key);
    if (rules === null) {
      return {
        productId,
        side: intent.side,
        orderId,
        finalState: 'risk_rejected',
        filledQuantity: null,
        issue: issue([productId], 'no_product_rules'),
      };
    }

    const bars = this.#market.bars(key);
    if (bars.length === 0) {
      return {
        productId,
        side: intent.side,
        orderId,
        finalState: 'risk_rejected',
        filledQuantity: null,
        issue: issue([productId], 'no_bars'),
      };
    }

      const outcome = simulateFill({
      instrument,
      symbol: intent.asset.symbol,
      side: intent.side,
      requestedUsd: String(intent.amountUsd),
      availableCashUsd: availableForPaperIntentUsd(
        approval,
        intent.side,
        instrument,
        String(selectExecutionBar(bars, approval.approvedAtMs)?.open ?? 0),
        this.#database,
      ),
      rules,
      bars,
      decidedAtMs: approval.approvedAtMs,
    });

    try {
      return inTransaction(this.#database, () => {
        // The rule snapshot is immutable evidence of what the venue permitted at
        // the moment the order was priced. It is written before the order so a
        // stored order can never reference a snapshot that does not exist.
      saveProductRuleSnapshot(rules, this.#database);

      const order: PaperOrder = {
        id: orderId,
        profileId: approval.profileId,
        runId: approval.runId,
        instrument,
        side: intent.side,
        requestedQuantity: (isFilled(outcome) ? outcome.quantity : '0') as PaperOrder['requestedQuantity'],
        requestedNotional: String(intent.amountUsd) as PaperOrder['requestedNotional'],
        state: 'proposed',
        productRuleSnapshotId: rules.id,
        decisionSnapshotHash: sha256Hex(`${approval.runId}:${productId}:${intent.side}`),
        reason: null,
        createdAt: now,
        updatedAt: now,
      };
      savePaperOrder(order, this.#database);
      this.#event(order, 'proposed', 0, now, {
        gatesPassed: approval.gatesPassed, admissionMode: approval.admissionMode,
        campaignId: approval.campaignId, profitabilityAssessment: approval.profitabilityAssessment,
        evidenceEligibility: approval.evidenceEligibility,
      });

      if (!isFilled(outcome)) {
        // The gate chain approved the intent; the venue then refused it on its
        // own rules. That is a risk_rejected order with the reason recorded,
        // not a silent no-op.
        this.#advance(order, 'risk_rejected', 1, now, outcome.reason ?? outcome.code);
        return {
          productId,
          side: intent.side,
          orderId,
          finalState: 'risk_rejected',
          filledQuantity: null,
          issue: issue([productId], 'venue_refused', outcome.reason ?? outcome.code),
        };
      }

      if (!fillIsSelfConsistent(outcome)) {
        this.#advance(order, 'risk_rejected', 1, now, 'inconsistent_fill');
        return {
          productId,
          side: intent.side,
          orderId,
          finalState: 'risk_rejected',
          filledQuantity: null,
          issue: issue([productId], 'inconsistent_fill'),
        };
      }

      // Walk the states the transition table permits; each one is an event.
      let sequence = 1;
      for (const state of ['risk_approved', 'submission_pending', 'submitted'] as const) {
        this.#advance(order, state, sequence, now, null);
        sequence += 1;
      }

      const fill: PaperFill = {
        id: sha256Hex(`${orderId}:${outcome.executionBarStartMs}`),
        orderId,
        profileId: approval.profileId,
        quantity: outcome.quantity as PaperFill['quantity'],
        executionPrice: outcome.executionPrice as PaperFill['executionPrice'],
        notional: outcome.notional as PaperFill['notional'],
        venueFee: outcome.venueFee as PaperFill['venueFee'],
        spreadCost: outcome.spreadCost as PaperFill['spreadCost'],
        slippageCost: outcome.slippageCost as PaperFill['slippageCost'],
        impactCost: outcome.impactCost as PaperFill['impactCost'],
        filledAt: outcome.filledAtMs,
        marketSnapshotHash: sha256Hex(
          `${key}:${outcome.executionBarStartMs}:${outcome.referencePrice}`,
        ),
      };

      const entries = paperFillLedgerEntries({
        instrument,
        side: intent.side,
        quantity: outcome.quantity,
        executionPrice: outcome.executionPrice,
        venueFee: outcome.venueFee,
      });

      // Fill, ledger legs and balances land in one transaction, and storage
      // asserts the legs sum to zero before any of it commits.
      commitPaperFill(fill, approval.runId, entries, this.#database);
      this.#advance(order, 'filled', sequence, outcome.filledAtMs, null);

      return {
        productId,
        side: intent.side,
        orderId,
        finalState: 'filled',
        filledQuantity: outcome.quantity,
        issue: null,
      };
      });
    } catch (error) {
      this.#onUnexpectedError(productId, error);
      return {
        productId,
        side: intent.side,
        orderId,
        finalState: 'unknown',
        filledQuantity: null,
        issue: issue([productId], 'storage_rejected'),
      };
    }
  }

  #advance(
    order: PaperOrder,
    state: PaperOrderState,
    sequence: number,
    at: number,
    reason: string | null,
  ): void {
    savePaperOrder({ ...order, state, reason, updatedAt: at }, this.#database);
    this.#event({ ...order, state }, state, sequence, at, reason === null ? {} : { reason });
  }

  #event(
    order: PaperOrder,
    state: PaperOrderState,
    sequence: number,
    at: number,
    detail: Record<string, unknown>,
  ): void {
    appendPaperOrderEvent(
      {
        id: `${order.id}:${sequence}`,
        orderId: order.id,
        profileId: order.profileId,
        sequence,
        state,
        at,
        detailJson: JSON.stringify({ paperOnly: true, ...detail }),
      },
      this.#database,
    );
  }
}

export { isApproved };
