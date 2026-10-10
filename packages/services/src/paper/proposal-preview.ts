import { Decimal as DecimalBase } from 'decimal.js';
import { computeAllocation, decimal, DEFAULT_TRADE_COST_CONFIG, instrumentKey, modeledFill, sha256Hex, type AllocationPolicy, type ExecutionIntent, type Holding } from '@coqui/core';
import { paperCostModelHash } from './venue.js';
import type { PaperMarketData } from './oms.js';
const Decimal = DecimalBase.clone({precision:40});
/** Modeled consequences at reference marks, never a broker fill or account valuation promise. */
export function proposalPreview(input: { proposalHash: string; revision: number; intents: readonly ExecutionIntent[];
  holdings: readonly Holding[]; allocationPolicy?: AllocationPolicy; market: PaperMarketData; nowMs: number; issuedAtMs: number; killSwitchEngaged: boolean }) {
  const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, proposalHash:input.proposalHash,
    revision:input.revision, previewHash:null, costHash:paperCostModelHash(), expiresAtMs:input.nowMs, actions:[], drift:[], totalCostUsd:null });
  if (!Number.isSafeInteger(input.issuedAtMs) || input.issuedAtMs>input.nowMs || input.nowMs-input.issuedAtMs>60_000) return unavailable('preview_expired');
  if (input.intents.length>0 && input.holdings.length===0) return unavailable('portfolio_scope_unavailable');
  if (input.killSwitchEngaged) return unavailable('kill_switch_engaged');
  if (input.holdings.some(h => h.valueUsd === null || h.priceUsd === null)) return unavailable('portfolio_marks_incomplete');
  const changes = new Map<string, DecimalBase>();
  const actions = [];
  for (const intent of input.intents) {
    const key = instrumentKey(intent.asset.instrument), bars = input.market.bars(key);
    const bar = bars.filter(b => b.isComplete && b.endTimeMs <= input.nowMs && b.retrievedAtMs <= input.nowMs).at(-1);
    if (!bar || bar.close <= 0 || input.nowMs-bar.endTimeMs > 86_400_000) return unavailable('reference_quote_unavailable');
    const amount = new Decimal(intent.amountUsd), before = input.holdings.find(h => instrumentKey(h.asset.instrument)===key)?.valueUsd ?? '0';
    if (!amount.isPositive()) return unavailable('invalid_notional');
    const fill = modeledFill(intent.side,amount.div(bar.close).toFixed(),String(bar.close),DEFAULT_TRADE_COST_CONFIG);
    const cumulative = (changes.get(key) ?? new Decimal(0)).add(amount.mul(intent.side==='buy'?1:-1));
    const after = new Decimal(before).add(cumulative);
    if (after.isNegative()) return unavailable('insufficient_marked_exposure');
    changes.set(key,cumulative);
    actions.push({ productId:intent.asset.instrument.productId, side:intent.side, feeUsd:fill.venueFee,
      spreadUsd:fill.spreadCost, slippageUsd:fill.slippageCost, impactUsd:fill.impactCost, totalCostUsd:fill.totalCost,
      beforeExposureUsd:new Decimal(before).toFixed(), afterExposureUsd:after.toFixed(), referenceAtMs:bar.endTimeMs,
      referencePriceUsd:String(bar.close) });
  }
  const afterHoldings = input.holdings.map(h=>({...h,valueUsd:decimal(new Decimal(h.valueUsd!).add(changes.get(instrumentKey(h.asset.instrument))??0).toFixed())}));
  for(const intent of input.intents) if(!afterHoldings.some(h=>instrumentKey(h.asset.instrument)===instrumentKey(intent.asset.instrument))) {
    afterHoldings.push({asset:intent.asset,quantity:decimal('0'),avgCostUsd:decimal('0'),priceUsd:decimal('0'),
      valueUsd:decimal(changes.get(instrumentKey(intent.asset.instrument))!.toFixed()),unrealizedPnlUsd:null,unrealizedPnlPct:null});
  }
  const beforeAllocation=computeAllocation(input.holdings,input.nowMs,input.allocationPolicy),afterAllocation=computeAllocation(afterHoldings,input.nowMs,input.allocationPolicy);
  const drift=afterAllocation.slices.map(s=>({productId:s.asset.instrument.productId,targetWeight:s.targetWeight,
    beforeDriftPct:beforeAllocation.slices.find(b=>instrumentKey(b.asset.instrument)===instrumentKey(s.asset.instrument))?.driftPct??null,afterDriftPct:s.driftPct}));
  const body = { issuedAtMs:input.issuedAtMs, proposalHash:input.proposalHash, revision:input.revision, costHash:paperCostModelHash(),
    portfolioHash:sha256Hex(JSON.stringify(input.holdings)), policyHash:sha256Hex(JSON.stringify(input.allocationPolicy??null)), actions, drift };
  return { status:'available' as const, reason:null, proposalHash:input.proposalHash, revision:input.revision,
    previewHash:sha256Hex(JSON.stringify(body)), costHash:body.costHash, expiresAtMs:input.issuedAtMs+60_000, actions,
    drift,totalCostUsd:actions.reduce((s,a)=>s.add(a.totalCostUsd),new Decimal(0)).toFixed() };
}
