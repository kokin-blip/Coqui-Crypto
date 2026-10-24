import { capitalHash } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D, budgetAmount as amount, nativeExecutionRules, type NativeExecutionRulesV1 } from '../execution/native-rules.js';
import { validateReserveSettings } from '../portfolio/profit-reserve.js';
import { CAPITAL_REPLAY_DAY as DAY, CAPITAL_REPLAY_GRID, CAPITAL_REPLAY_VERSION,
  type CapitalReplaySpecV1, type CapitalReplayTapeV1, type ReplayRule } from './capital-replay-types.js';

const hash = (v: string) => /^[a-f0-9]{64}$/u.test(v);
export function replayAmount(v: string, signed = false): void {
  const n = amount(v); if ((!signed && n.lt(0)) || n.precision() > 24) throw new TypeError('replay_amount_precision_or_sign');
}
export function validateCapitalReplay(spec: CapitalReplaySpecV1, tape?: CapitalReplayTapeV1): string {
  if (spec.version !== CAPITAL_REPLAY_VERSION || spec.mode !== 'offline_development' || spec.confirmatoryEligible !== false ||
    spec.liveExecutionPermitted !== false || !spec.originProfileId || !spec.workspaceId || !spec.codeRevision || !spec.pathId ||
    ![spec.sourceManifestHash,spec.lockfileHash,spec.marketTapeHash,spec.decisionTapeHash].every(hash) ||
    spec.supersedesSpecHash!==null&&!hash(spec.supersedesSpecHash) || !['synthetic','exposed_development'].includes(spec.exposure) || !['coinbase','alpaca'].includes(spec.provider) ||
    ![spec.fromMs,spec.toMs,spec.warmupFromMs,spec.seed,spec.publicationDelayMs].every(Number.isSafeInteger) || spec.warmupFromMs < 0 || spec.publicationDelayMs<0 || spec.seed<0 ||
    spec.fromMs < spec.warmupFromMs || spec.fromMs >= spec.toMs || spec.fromMs % DAY || spec.toMs % DAY ||
    (spec.toMs-spec.fromMs)/DAY > 5000 || spec.assets.length < 1 || spec.assets.length > 10 ||
    new Set(spec.assets).size !== spec.assets.length || spec.assets.some(a => !a.startsWith(`${spec.provider}|spot|`)) ||
    !Number.isSafeInteger(spec.passiveCadenceFrames) || spec.passiveCadenceFrames < 1) throw new TypeError('replay_spec_invalid');
  const unique = (ids: readonly string[]) => ids.every(id => id.length > 0 && id.length <= 256) && new Set(ids).size === ids.length;
  const weights = (w: Readonly<Record<string,string>>) => {
    let sum = new D(0); for (const [a,v] of Object.entries(w)) { if (!spec.assets.includes(a)) throw new TypeError('replay_asset_unknown'); replayAmount(v); sum=sum.add(v); }
    if (sum.gt(1)) throw new TypeError('replay_weights_exceed_one');
  };
  weights(spec.benchmarkWeights);
  if (spec.openings.length !== 9 || [...spec.openings.map(o=>o.capitalUsd)].sort().join() !== [...CAPITAL_REPLAY_GRID].sort().join() ||
    !unique(spec.variants.map(v=>v.id)) || !spec.variants.length || spec.cells.length > 256 || !unique(spec.cells.map(c=>c.id))) throw new TypeError('replay_grid_or_inventory_invalid');
  for (const o of spec.openings) {
    replayAmount(o.cashUsd); if (!unique(o.assets.map(a=>a.assetId))) throw new TypeError('replay_opening_duplicate');
    for (const a of o.assets) { if(!spec.assets.includes(a.assetId))throw new TypeError('replay_opening_asset'); replayAmount(a.quantity); if(a.costUsd!==null)replayAmount(a.costUsd); }
  }
  for (const v of spec.variants) {
    validateReserveSettings(v.reserve);
    if(v.cost.venue!==spec.provider || v.cost.role!=='taker' || ![1,2].includes(v.cost.multiplier) || !v.cost.sourceRef ||
      !Number.isSafeInteger(v.cost.feePostingLagFrames) || v.cost.feePostingLagFrames<0 || v.cost.feePostingLagFrames>5000 ||
      !Number.isSafeInteger(v.turnoverWindowMs) || v.turnoverWindowMs<1 || !Number.isSafeInteger(v.activationAtMs) || v.activationAtMs<spec.fromMs ||
      v.activationAtMs>=spec.toMs || !unique(v.flows.map(f=>f.id))) throw new TypeError('replay_variant_invalid');
    for(const n of [v.cost.feeRate,v.cost.fixedUsd,v.cost.spreadBps,v.cost.slippageBps,v.cost.impactBps,v.cost.impactRefUsd,v.activeDailyYield,v.reserveDailyYield]) replayAmount(n);
    if(amount(v.cost.feeRate).mul(v.cost.multiplier).gte(1)||amount(v.cost.impactRefUsd).lte(0))throw new TypeError('replay_cost_invalid');
    for(const key of ['maxOrderUsd','maxTurnoverUsd','usedTurnoverUsd','discretionaryFloorUsd'] as const) replayAmount(v.policy[key]);
    for(const key of ['maxEntryFraction','maxPositionFraction','accountMaxPositionFraction','maxInvestedFraction','accountMaxInvestedFraction'] as const){replayAmount(v.policy[key]);if(amount(v.policy[key]).gt(1))throw new TypeError('replay_risk_fraction');}
    if(!Number.isSafeInteger(v.policy.maxOrders)||v.policy.maxOrders<0||v.policy.maxOrders>100)throw new TypeError('replay_order_limit');
    for(const f of v.flows){
      for(const n of [f.amountUsd,f.feeUsd,f.userReceiptUsd])replayAmount(n);
      if(!Number.isSafeInteger(f.atMs)||f.atMs<spec.fromMs||f.atMs>=spec.toMs||!Number.isSafeInteger(f.sequence)||f.sequence<0)throw new TypeError('replay_flow_time');
      if(amount(f.userReceiptUsd).gt(f.amountUsd)||f.purpose==='personal_tax'&&amount(f.userReceiptUsd).gt(0))throw new TypeError('replay_receipt_exceeds_delivery');
    }
    if(new Set(v.flows.map(f=>`${f.atMs}:${f.sequence}`)).size!==v.flows.length)throw new TypeError('replay_flow_order_ambiguous');
    for(const e of v.externalExpenses){replayAmount(e.amountUsd);if(!Number.isSafeInteger(e.atMs)||e.atMs<spec.fromMs||e.atMs>spec.toMs)throw new TypeError('replay_expense_time');}
    if(v.reviewAtMs.some(t=>!Number.isSafeInteger(t)||t<spec.fromMs||t>=spec.toMs)||new Set(v.reviewAtMs).size!==v.reviewAtMs.length)throw new TypeError('replay_review_time');
    const cells=spec.cells.filter(c=>c.variantId===v.id),arms=new Set(cells.map(c=>c.arm));
    for(const arm of ['policy','cash','hold','passive',...(v.reserve.shareBps>0&&v.reserve.goal==='preview'?['reinvest']:[])] as const){
      if(!arms.has(arm as typeof cells[number]['arm'])||cells.filter(c=>c.arm===arm).map(c=>c.capitalUsd).sort().join()!==[...CAPITAL_REPLAY_GRID].sort().join())throw new TypeError('replay_matched_grid_missing');
    }
  }
  if(spec.cells.some(c=>!spec.openings.some(o=>o.capitalUsd===c.capitalUsd)||!spec.variants.some(v=>v.id===c.variantId))||
    new Set(spec.cells.map(c=>`${c.variantId}:${c.arm}:${c.capitalUsd}`)).size!==spec.cells.length)throw new TypeError('replay_cell_invalid');
  for(const r of spec.rules) if(!spec.assets.includes(r.assetId)||r.rules.assetId!==r.assetId||r.rules.provider!==spec.provider||r.fromMs>=r.toMs)throw new TypeError('replay_rule_identity');
  if(tape){
    if(capitalHash(tape.market)!==spec.marketTapeHash||capitalHash(tape.decisions)!==spec.decisionTapeHash)throw new TypeError('replay_tape_hash_mismatch');
    if(tape.market.length<1||tape.market.length>5000||tape.decisions.length>5000||!unique(tape.decisions.map(d=>d.id)))throw new TypeError('replay_tape_bounds');
    for(const [i,f] of tape.market.entries()){
      if(!Number.isSafeInteger(f.atMs)||f.atMs<spec.fromMs||f.atMs>=spec.toMs||f.atMs%DAY||f.endMs!==f.atMs+DAY||i>0&&f.atMs<=tape.market[i-1]!.atMs)throw new TypeError('replay_market_time');
      for(const [id,a] of Object.entries(f.assets)){
        if(!spec.assets.includes(id))throw new TypeError('replay_provider_mismatch');
        for(const n of [a.openUsd,a.closeUsd,a.bidUsd,a.askUsd]) if(n!==null){replayAmount(n);if(amount(n).lte(0))throw new TypeError('replay_price_invalid');}
        if((a.bidUsd===null)!==(a.askUsd===null)||a.bidUsd!==null&&amount(a.askUsd!).lt(a.bidUsd))throw new TypeError('replay_quote_invalid');
      }
    }
    if(new Set(tape.decisions.map(d=>d.policyHash)).size>1||new Set(tape.decisions.map(d=>d.executionAtMs)).size!==tape.decisions.length)throw new TypeError('replay_decision_order');
    for(const d of tape.decisions){
      if(![d.executionAtMs,d.decisionAtMs,d.availableAtMs,d.observedThroughMs].every(Number.isSafeInteger)||d.observedThroughMs<0||
        d.observedThroughMs<spec.warmupFromMs||d.observedThroughMs%DAY!==0||d.availableAtMs<d.observedThroughMs+spec.publicationDelayMs||d.availableAtMs>d.decisionAtMs||d.decisionAtMs>=d.executionAtMs||
        (Math.floor(d.decisionAtMs/DAY)+1)*DAY!==d.executionAtMs||d.executionAtMs<spec.fromMs||d.executionAtMs>=spec.toMs||!hash(d.policyHash)||
        !unique(d.priority)||d.priority.length!==spec.assets.length||d.priority.some(a=>!spec.assets.includes(a))||
        d.riskExits.some(a=>!spec.assets.includes(a)))throw new TypeError('replay_decision_noncausal');
      weights(d.targets);replayAmount(d.fill.fraction);
      if(amount(d.fill.fraction).gt(1)||d.fill.delayFrames!==null&&(!Number.isSafeInteger(d.fill.delayFrames)||d.fill.delayFrames<0||d.fill.delayFrames>5000))throw new TypeError('replay_fill_model_invalid');
      if(d.status==='abstain'&&Object.values(d.targets).some(v=>amount(v).gt(0)))throw new TypeError('replay_abstain_has_targets');
    }
  }
  return capitalHash(spec);
}
/** Historical observation time is retained in provenance; only explicit assumptions are materialized. */
export function replayRulesAt(input: ReplayRule, atMs: number): NativeExecutionRulesV1 {
  if(atMs<input.fromMs||atMs>=input.toMs) return {...input.rules,tradable:null};
  if(input.mode==='historical_observation')return input.rules;
  return nativeExecutionRules({...input.rules,assurance:'scenario',observedAtMs:atMs,expiresAtMs:atMs+30_000,
    source:'replay-static-rule-assumption',evidenceRefs:[input.rules.id,...input.rules.evidenceRefs],
    rawEvidenceJson:JSON.stringify({assumption:input.rules.id,fromMs:input.fromMs,toMs:input.toMs,originalObservedAtMs:input.rules.observedAtMs})});
}
