import { Decimal } from 'decimal.js';
import {
  decimal as decimalString,
  instrumentKey,
  type AssetQuantity,
  type DecimalString,
  type InstrumentIdentity,
  type InstrumentKey,
  type UsdAmount,
} from '../types/index.js';

/** Shared OMS states. Ambiguous submission outcomes must enter `unknown`. */
export type PaperOrderState =
  | 'proposed'
  | 'risk_approved'
  | 'risk_rejected'
  | 'submission_pending'
  | 'submitted'
  | 'acknowledged'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancel_pending'
  | 'cancelled'
  | 'expired'
  | 'unknown'
  | 'reconciled';

/** Immutable venue-rule evidence attached to an order decision. */
export interface ProductRuleSnapshot {
  id: string;
  instrument: InstrumentIdentity;
  status: string;
  tradingDisabled: boolean;
  cancelOnly: boolean;
  limitOnly: boolean;
  postOnly: boolean;
  viewOnly: boolean;
  baseIncrement: string;
  quoteIncrement: string;
  priceIncrement: string;
  baseMinSize: string;
  baseMaxSize: string | null;
  quoteMinSize: string;
  quoteMaxSize: string | null;
  source: 'coinbase';
  retrievedAt: number;
  responseHash: string;
}

export interface PaperOrder {
  id: string;
  profileId: string;
  runId: string;
  instrument: InstrumentIdentity;
  side: 'buy' | 'sell';
  requestedQuantity: AssetQuantity;
  requestedNotional: UsdAmount;
  state: PaperOrderState;
  productRuleSnapshotId: string;
  decisionSnapshotHash: string;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaperOrderEvent {
  id: string;
  orderId: string;
  profileId: string;
  sequence: number;
  state: PaperOrderState;
  at: number;
  detailJson: string;
}

export interface PaperFill {
  id: string;
  orderId: string;
  profileId: string;
  quantity: AssetQuantity;
  executionPrice: UsdAmount;
  notional: UsdAmount;
  venueFee: UsdAmount;
  spreadCost: UsdAmount;
  slippageCost: UsdAmount;
  impactCost: UsdAmount;
  filledAt: number;
  marketSnapshotHash: string;
}

export interface PaperLedgerEntry {
  account: 'cash' | 'asset' | 'venue_fee';
  instrument: InstrumentKey | null;
  amountUsd: DecimalString;
  quantity: DecimalString;
}

export interface NormalizedPaperOrder {
  accepted: boolean;
  quantity: AssetQuantity;
  notionalUsd: UsdAmount;
  reason: string | null;
}

const TRANSITIONS: Record<PaperOrderState, readonly PaperOrderState[]> = {
  proposed: ['risk_approved', 'risk_rejected', 'cancelled', 'expired'],
  risk_approved: ['submission_pending', 'cancelled', 'expired'],
  risk_rejected: [],
  submission_pending: ['submitted', 'unknown', 'cancelled'],
  submitted: ['acknowledged', 'open', 'partially_filled', 'filled', 'unknown'],
  acknowledged: ['open', 'partially_filled', 'filled', 'cancel_pending', 'cancelled', 'unknown'],
  open: ['partially_filled', 'filled', 'cancel_pending', 'cancelled', 'expired', 'unknown'],
  partially_filled: [
    'partially_filled',
    'filled',
    'cancel_pending',
    'cancelled',
    'expired',
    'unknown',
  ],
  filled: ['reconciled'],
  cancel_pending: ['cancelled', 'filled', 'unknown'],
  cancelled: ['reconciled'],
  expired: ['reconciled'],
  unknown: ['acknowledged', 'open', 'partially_filled', 'filled', 'cancelled', 'reconciled'],
  reconciled: [],
};

/** Validate an OMS state transition without mutating the order. */
export function canTransitionPaperOrder(from: PaperOrderState, to: PaperOrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

function parseDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function floorDecimal(value: Decimal, increment: Decimal): Decimal {
  if (!value.isPositive() || !increment.isPositive()) return new Decimal(0);
  return value.div(increment).floor().mul(increment);
}

function rejected(reason: string): NormalizedPaperOrder {
  return {
    accepted: false,
    quantity: decimalString('0'),
    notionalUsd: decimalString('0'),
    reason,
  };
}

/** Normalize to venue increments without ever rounding risk or cash use upward. */
export function normalizePaperOrder(
  requestedUsd: string,
  priceUsd: string,
  rules: ProductRuleSnapshot,
  availableCashUsd: string,
): NormalizedPaperOrder {
  const request = parseDecimal(requestedUsd);
  const price = parseDecimal(priceUsd);
  const cash = parseDecimal(availableCashUsd);
  const baseIncrement = parseDecimal(rules.baseIncrement);
  const quoteIncrement = parseDecimal(rules.quoteIncrement);
  const baseMin = parseDecimal(rules.baseMinSize);
  const baseMax = rules.baseMaxSize ? parseDecimal(rules.baseMaxSize) : null;
  const quoteMin = parseDecimal(rules.quoteMinSize);
  const quoteMax = rules.quoteMaxSize ? parseDecimal(rules.quoteMaxSize) : null;
  if (
    !request ||
    !price ||
    !cash ||
    !baseIncrement ||
    !quoteIncrement ||
    !baseMin ||
    !quoteMin ||
    !request.isPositive() ||
    !price.isPositive() ||
    cash.isNegative() ||
    !baseIncrement.isPositive() ||
    !quoteIncrement.isPositive()
  ) {
    return rejected('Invalid decimal input.');
  }
  if (
    rules.source !== 'coinbase' ||
    rules.instrument.productType !== 'spot' ||
    rules.status !== 'online' ||
    rules.tradingDisabled ||
    rules.cancelOnly ||
    rules.limitOnly ||
    rules.postOnly ||
    rules.viewOnly
  ) {
    return rejected('Coinbase product rules do not permit a simulated market order.');
  }

  const boundedRequest = Decimal.min(request, cash);
  let quantity = floorDecimal(boundedRequest.div(price), baseIncrement);
  if (baseMax && quantity.gt(baseMax)) quantity = floorDecimal(baseMax, baseIncrement);
  let notional = floorDecimal(quantity.mul(price), quoteIncrement);
  if (quoteMax && notional.gt(quoteMax)) {
    notional = floorDecimal(quoteMax, quoteIncrement);
    quantity = floorDecimal(notional.div(price), baseIncrement);
    notional = floorDecimal(quantity.mul(price), quoteIncrement);
  }
  if (quantity.lt(baseMin)) {
    return rejected(`Quantity is below the ${rules.baseMinSize} base minimum.`);
  }
  if (notional.lt(quoteMin)) {
    return rejected(`Notional is below the $${rules.quoteMinSize} quote minimum.`);
  }
  return {
    accepted: true,
    quantity: decimalString(quantity.toFixed()),
    notionalUsd: decimalString(notional.toFixed()),
    reason: null,
  };
}

/** Move spread, slippage, and impact into fill price rather than venue fee. */
export function paperExecutionPrice(input: {
  side: 'buy' | 'sell';
  referencePrice: string;
  quantity: string;
  spreadCost: string;
  slippageCost: string;
  impactCost: string;
}): UsdAmount {
  const price = parseDecimal(input.referencePrice);
  const quantity = parseDecimal(input.quantity);
  const spread = parseDecimal(input.spreadCost);
  const slippage = parseDecimal(input.slippageCost);
  const impact = parseDecimal(input.impactCost);
  if (
    !price ||
    !quantity ||
    !spread ||
    !slippage ||
    !impact ||
    !price.isPositive() ||
    !quantity.isPositive() ||
    spread.isNegative() ||
    slippage.isNegative() ||
    impact.isNegative()
  ) {
    throw new Error('Invalid paper execution cost input.');
  }
  const adjustment = spread.add(slippage).add(impact).div(quantity);
  const execution = input.side === 'buy' ? price.add(adjustment) : price.sub(adjustment);
  if (!execution.isPositive()) throw new Error('Paper execution price must remain positive.');
  return decimalString(execution.toFixed());
}

/** Create exact double-entry postings for one simulated fill. */
export function paperFillLedgerEntries(input: {
  instrument: InstrumentIdentity;
  side: 'buy' | 'sell';
  quantity: string;
  executionPrice: string;
  venueFee: string;
}): PaperLedgerEntry[] {
  const quantity = parseDecimal(input.quantity);
  const price = parseDecimal(input.executionPrice);
  const fee = parseDecimal(input.venueFee);
  if (!quantity?.isPositive() || !price?.isPositive() || !fee || fee.isNegative()) {
    throw new Error('Invalid paper fill decimal input.');
  }
  const notional = quantity.mul(price);
  const asset = instrumentKey(input.instrument);
  if (input.side === 'buy') {
    return [
      {
        account: 'asset',
        instrument: asset,
        amountUsd: decimalString(notional.toFixed()),
        quantity: decimalString(quantity.toFixed()),
      },
      {
        account: 'venue_fee',
        instrument: null,
        amountUsd: decimalString(fee.toFixed()),
        quantity: decimalString('0'),
      },
      {
        account: 'cash',
        instrument: null,
        amountUsd: decimalString(notional.add(fee).neg().toFixed()),
        quantity: decimalString('0'),
      },
    ];
  }
  return [
    {
      account: 'cash',
      instrument: null,
      amountUsd: decimalString(notional.sub(fee).toFixed()),
      quantity: decimalString('0'),
    },
    {
      account: 'venue_fee',
      instrument: null,
      amountUsd: decimalString(fee.toFixed()),
      quantity: decimalString('0'),
    },
    {
      account: 'asset',
      instrument: asset,
      amountUsd: decimalString(notional.neg().toFixed()),
      quantity: decimalString(quantity.neg().toFixed()),
    },
  ];
}
