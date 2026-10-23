import { registerHooks, createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const sourceRoot = pathToFileURL(root + '/packages/core/src/').href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
    const source = new URL(specifier.slice(0,-3)+'.ts', context.parentURL);
    if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
  }
  return nextResolve(specifier, context);
}});
const require = createRequire(root + '/packages/core/package.json');
const Decimal = require('decimal.js');
const { planExecution } = await import(sourceRoot + 'execution/remediation-planner.ts');
const { resolvePortfolioSizingPolicy, guardrailsForPortfolioSizing, buyCandidateConfigForPortfolioSizing } = await import(sourceRoot + 'risk/portfolio-sizing.ts');
const balances = ['50','100','250','500','1000','2500','5000','10000','100000'];
const slotMs = Date.parse('2026-10-22T04:00:00Z');
function plan(balance, targetWeight, held='0', requiredExit=false) {
  const heldValue = new Decimal(held).mul(100);
  return planExecution({namespace:'synthetic-small-account-research', revision:1, slotMs, nowMs:slotMs,
    policy:'B', stage:requiredExit?'sell':'buy', target:{id:'synthetic-target',completedDay:'2026-10-21',datasetHash:'a'.repeat(64),weights:{synthetic:targetWeight}}, previousTarget:null,
    snapshot:{atMs:slotMs,accountAtMs:slotMs,positionsAtMs:slotMs,cash:new Decimal(balance).minus(heldValue).toString(),equity:balance,
      assets:[{id:'synthetic',symbol:'SYNTHETIC',held,marketValue:heldValue.toString(),bid:'100',ask:'100',quoteAtMs:slotMs,rulesAtMs:slotMs,tradable:true,status:'active',increment:'0.000001',minimum:'0.000001',completedClose:'100',requiredExit}]},
    fulfilledAssetIds:[],pendingAssetIds:[],reservedCash:'0',limits:{maxOrders:3,maxTurnoverUsd:balance,maxOrderUsd:balance,maxPositionWeight:'1',maxInvestedWeight:'1'}});
}
const rows = balances.map(balance => {
  const p=plan(balance,'0.05');
  const sizing=resolvePortfolioSizingPolicy({portfolioValueUsd:Number(balance)});
  const guard=guardrailsForPortfolioSizing(sizing), cfg=buyCandidateConfigForPortfolioSizing(sizing);
  const split=cfg.maxCandidates>0?Math.min(cfg.sleevePct/cfg.maxCandidates,cfg.maxCandidateWeightPct):0;
  return {balanceUsd:balance,coqui25UsdMinimumPct:new Decimal(25).div(balance).mul(100).toFixed(4),onePctDriftUsd:new Decimal(balance).mul('.01').toString(),fivePctEntryUsd:new Decimal(balance).mul('.05').toString(),fivePctEntryOrders:p.orders.map(o=>({quantity:o.quantity,notionalUsd:o.notional})),blocked:p.blocked,
    helperPolicy:{tier:sizing.tier,minTradeUsd:guard.minTradeUsd,maxTurnoverPct:guard.maxTurnoverPct,maxTurnoverUsd:new Decimal(balance).mul(guard.maxTurnoverPct).toString(),cashReservePct:sizing.cashReservePct,candidateSleevePct:cfg.sleevePct,maxCandidates:cfg.maxCandidates,perCandidateWeightWhenAllSlotsUsed:split,perCandidateUsdWhenAllSlotsUsed:new Decimal(balance).mul(String(split)).toString()}};
});
assert.equal(rows.find(r=>r.balanceUsd==='100').fivePctEntryOrders.length,0);
assert.equal(rows.find(r=>r.balanceUsd==='500').fivePctEntryOrders[0].notionalUsd,'25');
const exit=plan('100','0','0.2',true);
assert.equal(exit.orders.length,0);
assert.equal(exit.blocked[0].reason,'minimum_after_rounding');
const firstTierFee=new Decimal('.0025');
const feeOnlyBreakEvenPct=new Decimal(1).div(new Decimal(1).minus(firstTierFee).pow(2)).minus(1).mul(100);
assert(feeOnlyBreakEvenPct.gt('.5') && feeOnlyBreakEvenPct.lt('.502'));
const files=['packages/core/src/execution/remediation-planner.ts','packages/core/src/risk/portfolio-sizing.ts','packages/core/src/risk/autotrade.ts','packages/core/src/strategies/buy-candidates.ts'];
const result={researchDate:'2026-10-22',timezone:'America/Phoenix',kind:'synthetic_source_probe_not_market_backtest',nodeVersion:process.version,assumptions:['Single fictional asset priced at $100 with zero spread','Synthetic increments and minima of 0.000001 units; no venue account accessed','Existing research planner policy B; ample limits and no pending orders','5% target entry from cash; current hard $25 policy minimum','Source helper outputs are not evidence of runtime integration'],sourceHashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(root+'/'+f)).digest('hex')])),capitalRows:rows,requiredExitCase:{balanceUsd:'100',positionUsd:'20',orders:exit.orders,blocked:exit.blocked},feeOnlyRoundTripBreakEvenPct:feeOnlyBreakEvenPct.toFixed(10),assertions:'passed'};
console.log(JSON.stringify(result,null,2));
