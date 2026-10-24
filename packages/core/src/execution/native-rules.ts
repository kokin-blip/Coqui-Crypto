import { Decimal } from 'decimal.js';
import { capitalHash } from '../portfolio/capital-ledger.js';

export const BudgetDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type NativeRuleValue = { readonly state: 'known'; readonly value: string } |
  { readonly state: 'not_applicable'; readonly evidenceRef: string } |
  { readonly state: 'unknown'; readonly reason: string };
export interface NativeExecutionRulesV1 {
  readonly id: string; readonly version: 'native-execution-rules-v1';
  readonly provider: 'coinbase' | 'alpaca'; readonly environment: 'production_read_only' | 'paper';
  readonly assetId: string; readonly productId: string; readonly baseCurrency: string; readonly quoteCurrency: 'USD';
  readonly form: 'market_quantity'; readonly timeInForce: 'gtc' | 'ioc';
  readonly tradable: boolean | null; readonly assurance: 'observed' | 'scenario';
  readonly quantityIncrement: NativeRuleValue; readonly quantityMin: NativeRuleValue; readonly quantityMax: NativeRuleValue;
  readonly quoteIncrement: NativeRuleValue; readonly quoteMin: NativeRuleValue; readonly quoteMax: NativeRuleValue;
  readonly priceIncrement: NativeRuleValue; readonly observedAtMs: number; readonly expiresAtMs: number;
  readonly source: string; readonly evidenceRefs: readonly string[];
  readonly rawEvidenceJson: string;
}
export const knownNativeRule = (value: string): NativeRuleValue => ({ state: 'known', value });
export const unknownNativeRule = (reason: string): NativeRuleValue => ({ state: 'unknown', reason });
export const inapplicableNativeRule = (evidenceRef: string): NativeRuleValue => ({ state: 'not_applicable', evidenceRef });
export function identifiedBudgetFact<T extends object>(input: T): T & { readonly id: string } {
  const body = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')) as T;
  return { ...body, id: capitalHash(body) };
}
export function nativeExecutionRules(input: Omit<NativeExecutionRulesV1, 'id' | 'version' | 'rawEvidenceJson'> & { readonly rawEvidenceJson?: string }): NativeExecutionRulesV1 {
  const body = { ...input, rawEvidenceJson: input.rawEvidenceJson ?? '{}', version: 'native-execution-rules-v1' as const };
  return identifiedBudgetFact(body);
}
export function budgetAmount(value: string): Decimal {
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) || value.replace(/\D/gu, '').length > 80) throw new TypeError('budget_invalid_decimal');
  const parsed = new BudgetDecimal(value); if (!parsed.isFinite()) throw new TypeError('budget_invalid_decimal'); return parsed;
}
export const budgetText = (value: Decimal): string => value.isZero() ? '0' : value.toFixed();
export function nativeRuleReasons(rule: NativeExecutionRulesV1, nowMs: number): string[] {
  const reasons: string[] = [];
  if (rule.tradable === null) reasons.push('tradability_unknown');
  else if (!rule.tradable) reasons.push('native_trading_disabled');
  if (rule.observedAtMs > nowMs || nowMs >= rule.expiresAtMs || nowMs - rule.observedAtMs > 30_000) reasons.push('native_rules_stale');
  for (const [name, field] of Object.entries(rule)) {
    if (typeof field !== 'object' || field === null || !('state' in field)) continue;
    const item = field as NativeRuleValue;
    if (item.state === 'unknown') reasons.push(`native_${name}_unknown`);
    if (item.state === 'known' && !budgetAmount(item.value).gt(0)) reasons.push(`native_${name}_invalid`);
  }
  if (rule.quantityIncrement.state !== 'known' || rule.quantityMin.state !== 'known') reasons.push('native_quantity_rules_missing');
  return reasons;
}
