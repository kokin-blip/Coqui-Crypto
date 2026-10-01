import { Decimal } from 'decimal.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';

export const EXECUTION_ARMS = ['A', 'B', 'C', 'D', 'passive-btc', 'passive-equal-weight', 'cash'] as const;
export type ExecutionArm = typeof EXECUTION_ARMS[number];
export const EXECUTION_COST_MODELS = Object.freeze({
  legacyLocal: { id: 'coqui-local-conservative-v1', fee: '0.006', spread: '0.001', slippage: '0.0015' },
  alpacaShadow: { id: 'alpaca-market-shadow-v1', fee: '0.0025', slippage: '0.0015', spread: 'observed-half-spread' },
});
export interface ExecutionTarget {
  readonly id: string; readonly completedDay: string; readonly datasetHash: string;
  readonly weights: Readonly<Record<string, string>>;
}
export interface ExecutionAsset {
  readonly id: string; readonly symbol: string; readonly held: string; readonly marketValue: string;
  readonly bid: string; readonly ask: string; readonly quoteAtMs: number; readonly rulesAtMs: number;
  readonly tradable: boolean; readonly status: string; readonly increment: string; readonly minimum: string;
  readonly completedClose: string; readonly requiredExit?: boolean;
}
export interface ExecutionSnapshot {
  readonly atMs: number; readonly accountAtMs: number; readonly positionsAtMs: number;
  readonly cash: string; readonly equity: string; readonly assets: readonly ExecutionAsset[];
}
export type TargetChange = 'reduction' | 'increase' | 'unchanged';
export function classifyTargetChange(target: ExecutionTarget, prior: ExecutionTarget | null, id: string): TargetChange {
  const current = new Decimal(target.weights[id] ?? '0');
  const previous = new Decimal(prior?.weights[id] ?? '0');
  return current.lt(previous) ? 'reduction' : current.gt(previous) ? 'increase' : 'unchanged';
}
export interface PlannedExecutionIntent {
  readonly id: string; readonly clientOrderId: string; readonly assetId: string; readonly side: 'sell' | 'buy';
  readonly quantity: string; readonly midpoint: string; readonly notional: string;
  readonly reason: 'risk_exit' | 'target_reduction' | 'target_increase' | 'routine_drift' | 'baseline';
  readonly reservedCash: string;
}
export interface ExecutionPlanInput {
  readonly namespace: string; readonly revision: number; readonly slotMs: number; readonly nowMs: number;
  readonly policy: ExecutionArm; readonly stage: 'sell' | 'buy'; readonly target: ExecutionTarget;
  readonly previousTarget: ExecutionTarget | null; readonly snapshot: ExecutionSnapshot;
  readonly fulfilledAssetIds: readonly string[]; readonly pendingAssetIds: readonly string[];
  readonly reservedCash: string;
  readonly costMultiplier?: 1 | 2;
  readonly limits: { readonly maxOrders: number; readonly maxTurnoverUsd: string;
    readonly maxOrderUsd: string; readonly maxPositionWeight: string; readonly maxInvestedWeight: string };
}
export interface ExecutionPlan {
  readonly id: string; readonly inputHash: string; readonly policyVersion: string;
  readonly orders: readonly PlannedExecutionIntent[]; readonly blocked: readonly { assetId: string; reason: string }[];
  readonly fulfilledAssetIds: readonly string[];
}
function positive(value: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || !parsed.gt(0)) throw new Error('invalid_planner_amount');
  return parsed;
}

/** Pure sizing. A deliberately retains daily-close versus intraday-midpoint baseline differences. */
export function planExecution(input: ExecutionPlanInput): ExecutionPlan {
  const { snapshot, policy, target } = input;
  const equity = policy === 'A' ? positive(snapshot.equity) : positive(snapshot.assets.reduce((sum,asset) =>
    sum.plus(new Decimal(asset.held).mul(positive(asset.bid).plus(positive(asset.ask)).div(2))), new Decimal(snapshot.cash)).toString()), fee = new Decimal(EXECUTION_COST_MODELS.alpacaShadow.fee);
  if (input.nowMs < input.slotMs || input.nowMs >= input.slotMs + 900_000 || input.slotMs % 14_400_000 !== 0 ||
      [input.slotMs,input.nowMs,snapshot.atMs,snapshot.accountAtMs,snapshot.positionsAtMs].some((at) => !Number.isSafeInteger(at)) ||
      [snapshot.atMs, snapshot.accountAtMs, snapshot.positionsAtMs].some((at) => at > input.nowMs || input.nowMs - at > 30_000))
    throw new Error('incoherent_execution_snapshot');
  if (!target.id || !/^[a-f0-9]{64}$/u.test(target.datasetHash)) throw new Error('invalid_target_identity');
  if (input.previousTarget && input.previousTarget.completedDay > target.completedDay) throw new Error('invalid_target_chronology');
  if (input.previousTarget?.id === target.id && canonicalJson(input.previousTarget as unknown as CanonicalJsonValue) !==
      canonicalJson(target as unknown as CanonicalJsonValue)) throw new Error('target_identity_conflict');
  const targetDate = new Date(input.slotMs - 86_400_000).toISOString().slice(0,10);
  if (target.completedDay !== targetDate) throw new Error('stale_execution_target');
  const weights = Object.values(target.weights).map((weight) => new Decimal(weight));
  if (weights.some((w) => !w.isFinite() || w.lt(0) || w.gt(1)) || Decimal.sum(0, ...weights).gt(1))
    throw new Error('invalid_target_weights');
  const daily = input.slotMs % 86_400_000 === 0;
  const inputHash = sha256Hex(canonicalJson(input as unknown as CanonicalJsonValue));
  const id = sha256Hex(`execution-plan-v1:${input.namespace}:${inputHash}`);
  const orders: PlannedExecutionIntent[] = [], blocked: {assetId: string; reason: string}[] = [];
  const fulfilled = new Set(input.fulfilledAssetIds);
  let available = new Decimal(snapshot.cash).minus(input.reservedCash), turnover = new Decimal(0);
  if (!available.isFinite() || available.lt(0)) throw new Error('invalid_cash_reservation');
  if (new Set(snapshot.assets.map((asset) => asset.id)).size !== snapshot.assets.length) throw new Error('duplicate_execution_asset');
  let invested = snapshot.assets.reduce((sum,asset)=>sum.plus(new Decimal(asset.held).mul(positive(asset.bid).plus(positive(asset.ask)).div(2))),new Decimal(0));
  for (const asset of snapshot.assets) {
    const reject = (reason: string) => blocked.push({ assetId: asset.id, reason });
    const bid = positive(asset.bid), ask = positive(asset.ask), midpoint = bid.plus(ask).div(2);
    if (!Number.isSafeInteger(asset.quoteAtMs) || !Number.isSafeInteger(asset.rulesAtMs) || ask.lt(bid) || input.nowMs - asset.quoteAtMs > 60_000 || asset.quoteAtMs > input.nowMs + 5_000 ||
        input.nowMs - asset.rulesAtMs > 30_000 || asset.rulesAtMs > input.nowMs) { reject('stale_evidence'); continue; }
    if (!asset.tradable || asset.status !== 'active') { reject('ineligible'); continue; }
    if (input.pendingAssetIds.includes(asset.id)) { reject('pending_order'); continue; }
    const held = new Decimal(asset.held), weight = new Decimal(target.weights[asset.id] ?? '0');
    if (!held.isFinite() || held.lt(0)) throw new Error('invalid_holdings');
    const actual = policy === 'A' && daily ? new Decimal(asset.marketValue) : held.mul(midpoint);
    const drift = weight.minus(actual.div(equity));
    const change = classifyTargetChange(target, input.previousTarget, asset.id);
    const pendingChange = !fulfilled.has(asset.id) && change !== 'unchanged';
    const changeBand = change === 'reduction' ? new Decimal('0.01') : new Decimal('0.03');
    if (pendingChange && (change === 'reduction' ? drift.gte(changeBand.neg()) : drift.lte(changeBand))) fulfilled.add(asset.id);
    let band = policy === 'A' ? new Decimal(daily ? '0.05' : '0.01') : new Decimal('0.01');
    let destination = weight;
    let reason: PlannedExecutionIntent['reason'] = policy === 'A' ? 'baseline' : 'routine_drift';
    if (policy === 'C' || policy === 'D') {
      band = pendingChange && !fulfilled.has(asset.id) ? changeBand : new Decimal('0.03');
      if (pendingChange && !fulfilled.has(asset.id)) reason = change === 'reduction' ? 'target_reduction' : 'target_increase';
      else destination = drift.gt(0) ? Decimal.max(0, weight.minus(band)) : Decimal.min(1, weight.plus(band));
    }
    if (asset.requiredExit) { destination = new Decimal(0); reason = 'risk_exit'; }
    else if (policy === 'A' ? drift.abs().lt(band) : drift.abs().lte(band)) continue;
    const sizing = policy === 'A' && daily ? positive(asset.completedClose) : midpoint;
    let delta = equity.mul(destination).div(sizing).minus(held);
    if (policy === 'A' && daily) delta = delta.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN);
    const side = delta.lt(0) ? 'sell' : 'buy';
    if (delta.isZero() || side !== input.stage) continue;
    if (side === 'buy' && policy === 'D' && fee.plus(ask.minus(bid).div(2).div(midpoint)).gt('0.005')) {
      reject('discretionary_entry_cost'); continue;
    }
    const increment = positive(asset.increment), minimum = positive(asset.minimum);
    const multiplier = input.costMultiplier ?? 1;
    const reservePrice = policy === 'A' ? sizing.mul('1.01') : midpoint.plus(ask.minus(bid).div(2).plus(midpoint.mul('0.0015')).mul(multiplier));
    const raw = side === 'sell' ? Decimal.min(delta.abs(), held) : Decimal.min(delta, available.div(reservePrice));
    const quantity = raw.div(increment).floor().mul(increment), notional = quantity.mul(sizing);
    if (quantity.lt(minimum) || notional.lt(25)) { reject('minimum_after_rounding'); continue; }
    if (orders.length >= input.limits.maxOrders || notional.gt(input.limits.maxOrderUsd) ||
        turnover.plus(notional).gt(input.limits.maxTurnoverUsd) || (side === 'buy' &&
        (held.plus(quantity).mul(midpoint).div(equity).gt(input.limits.maxPositionWeight) ||
          invested.plus(quantity.mul(midpoint)).div(equity).gt(input.limits.maxInvestedWeight)))) {
      reject('guardrail'); continue;
    }
    const reservedCash = side === 'buy' ? quantity.mul(reservePrice) : new Decimal(0);
    const intentId = sha256Hex(`${id}:${asset.id}:${side}`);
    orders.push({ id: intentId, clientOrderId: `coqui-${intentId.slice(0,40)}`, assetId: asset.id,
      side, quantity: quantity.toString(), midpoint: midpoint.toString(), notional: notional.toString(), reason,
      reservedCash: reservedCash.toString() });
    invested = invested.plus(quantity.mul(midpoint).mul(side==='buy'?1:-1));
    available = available.minus(reservedCash); turnover = turnover.plus(notional);
  }
  return { id, inputHash, policyVersion: `trendvol-execution-${policy}-v1`, orders, blocked, fulfilledAssetIds: [...fulfilled].sort() };
}

/** Changed sizing evidence creates a new identity; attempted intents must first be reconciled. */
export function revalidateExecutionPlan(priorInput: ExecutionPlanInput, currentInput: ExecutionPlanInput,
  attemptedIntentIds: readonly string[]): ExecutionPlan {
  const prior=planExecution(priorInput);
  const material=(input:ExecutionPlanInput)=>canonicalJson({target:input.target,snapshot:{cash:input.snapshot.cash,
    equity:input.snapshot.equity,assets:input.snapshot.assets.map(({quoteAtMs,rulesAtMs,...asset})=>{void quoteAtMs;void rulesAtMs;return asset;})},
    pendingAssetIds:input.pendingAssetIds,reservedCash:input.reservedCash,limits:input.limits} as unknown as CanonicalJsonValue);
  if(material(priorInput)===material(currentInput)) return prior;
  if(attemptedIntentIds.some((id)=>prior.orders.some((order)=>order.id===id))) throw new Error('attempted_intent_requires_reconciliation');
  return planExecution({...currentInput,namespace:priorInput.namespace,revision:priorInput.revision+1});
}
