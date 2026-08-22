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
  commitPaperFill,
  listPaperBalances,
  saveProductRuleSnapshot,
  savePaperOrder,
  type Db,
} from '@coqui/storage';

import { isApproved, type ApprovedExecution } from './execution-gate.js';
import { isFilled, simulateFill, type VenueOutcome } from './venue.js';

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

const OPENING_CASH_ASSET = 'USD' as const;

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
  return sha256Hex(`${approval.profileId}:${approval.runId}:${productId}:${side}`);
}

function availableCashUsd(profileId: string, database: Db): string {
  const balances = listPaperBalances(profileId, database);
  return balances.find((balance) => balance.assetId === OPENING_CASH_ASSET)?.quantity ?? '0';
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
  // Normalisation floors to the venue's increment, so the notional is at or
  // below price × quantity; it must never exceed it.
  const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-9);
  return actual <= expected + tolerance;
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
      availableCashUsd: availableCashUsd(approval.profileId, this.#database),
      rules,
      bars,
      decidedAtMs: approval.approvedAtMs,
    });

    try {
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
      this.#event(order, 'proposed', 0, now, { gatesPassed: approval.gatesPassed });

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
