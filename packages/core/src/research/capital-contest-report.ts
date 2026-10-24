import {BudgetDecimal as D,budgetAmount as amount,budgetText as text} from '../execution/native-rules.js';
import {reserveUnavailable} from '../portfolio/profit-reserve.js';
import type {CapitalMetric} from '../portfolio/capital-ledger.js';
import type {ReplayCellResult} from './capital-replay-types.js';
/** Additional attribution never changes cash, units or booked costs. */
export function contestAttribution(result:ReplayCellResult,rollingDays:readonly number[]):Record<string,CapitalMetric>{
 const refs=[result.scopeId],value=(n:InstanceType<typeof D>,method:string):CapitalMetric=>({state:'available',value:text(n.toDecimalPlaces(12,D.ROUND_DOWN)),method:`capital-contest-v1:${method}`,evidenceRefs:refs});
 const missing=reserveUnavailable('attribution_inputs_unavailable'),s=result.summary,metrics:Record<string,CapitalMetric>={};
 metrics['userNetZeroExtraExpenseUsd']=s.endingEquityUsd===null?missing:value(amount(s.endingEquityUsd).add(s.receiptsUsd),'equity-plus-simulated-receipts');
 metrics['userNetDeclaredExpenseUsd']=s.userNetOutcomeUsd===null?missing:value(amount(s.userNetOutcomeUsd),'outside-expense-deducted-once');
 const capital=amount(result.cell.capitalUsd).add(s.contributionsUsd);metrics['receiptsToContributedPct']=capital.lte(0)?reserveUnavailable('zero_denominator'):value(amount(s.receiptsUsd).div(capital).mul(100),'simulated-receipts-over-opening-plus-contributions-not-profit-paid');
 const opens=result.traces.filter(t=>t.phase==='open'),fractions:InstanceType<typeof D>[]=[],concentrations:InstanceType<typeof D>[]=[];
 for(const t of opens){if(t.equityUsd===null||t.activeUsd===null||amount(t.activeUsd).lte(0)||t.maximumWeight===null){fractions.length=0;break;}fractions.push(amount(t.equityUsd).sub(t.cashUsd).sub(t.pendingUsd).div(t.activeUsd));concentrations.push(amount(t.maximumWeight));}
 metrics['meanInvestedPct']=fractions.length===opens.length&&fractions.length?value(fractions.reduce((s,x)=>s.add(x),new D(0)).div(fractions.length).mul(100),'mean-observed-open-active-exposure'):missing;
 metrics['maxConcentrationPct']=fractions.length===opens.length&&concentrations.length?value(D.max(...concentrations).mul(100),'maximum-observed-open-active-weight'):missing;
 const points=result.totalPerformance.length===1?result.totalPerformance[0]!.points:[],nav=new Map<number,string>();for(const p of points)if(p.unitNavUsd!==null&&p.atMs%86400000===0)nav.set(p.atMs,p.unitNavUsd);
 const dates=[...nav.keys()].sort((a,b)=>a-b),complete=dates.length>1&&dates.every((t,i)=>i===0 || (t-dates[i-1]!) === 86400000);
 for(const days of rollingDays){const returns:InstanceType<typeof D>[]=[];if(complete)for(let i=days;i<dates.length;i++){const start=amount(nav.get(dates[i-days]!)!);if(start.gt(0))returns.push(amount(nav.get(dates[i]!)!).div(start).sub(1).mul(100));}
  metrics[`worstRolling${days}ReturnPct`]=returns.length?value(D.min(...returns),`worst-complete-${days}-day-unit-nav-return`):reserveUnavailable('rolling_history_unavailable');
 }
 return metrics;
}
