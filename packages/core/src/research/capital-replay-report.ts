import { capitalHash } from '../portfolio/capital-ledger.js';
import { budgetAmount as amount, budgetText as text } from '../execution/native-rules.js';
import { CAPITAL_REPLAY_VERSION, type CapitalReplaySpecV1, type CapitalReplayResultV1, type ReplayCellResult } from './capital-replay-types.js';
export function assembleCapitalReplayResult(spec:CapitalReplaySpecV1,cells:readonly ReplayCellResult[]):CapitalReplayResultV1{
 const specHash=capitalHash(spec);
  const comparisons=cells.filter(c=>c.cell.arm==='policy').flatMap(c=>{
    const control=cells.find(b=>b.cell.variantId===c.cell.variantId&&b.cell.capitalUsd===c.cell.capitalUsd&&b.cell.arm==='reinvest');
    return control?[{cellId:c.cell.id,controlId:control.cell.id,outcomeDifferenceUsd:c.summary.userNetOutcomeUsd===null||control.summary.userNetOutcomeUsd===null?null:text(amount(c.summary.userNetOutcomeUsd).sub(control.summary.userNetOutcomeUsd))}]:[];
  });
  const body={version:CAPITAL_REPLAY_VERSION,specHash,mode:'offline_development' as const,confirmatoryEligible:false as const,liveExecutionPermitted:false as const,cells,variantInventory:spec.cells,comparisons,
    limitations:['Cost model bounded_request_impact_v1: requested-notional quote bound before sizing; price-friction attribution is not a second debit.','Conditional frozen decision tape; nine capital cells are not independent alpha confirmations.','All fills, fees, interest and receipts are simulated; no financial authority.','No queue/capacity inference, strategy selection, significance, registration or qualification.','Legacy engines, negative findings and consumed holdout identities remain unchanged.']};
  return {...body,id:capitalHash(body)};
}

export function capitalReplayCsv(result:CapitalReplayResultV1):string {
 const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
 const fields=['cell','capital_usd','arm','state','equity_usd','active_usd','reserved_usd','simulated_receipts_usd','fees_usd','turnover_usd','user_net_outcome_usd'];
 const rows=result.cells.map(c=>["'"+c.cell.id,c.cell.capitalUsd,c.cell.arm,c.state,c.summary.endingEquityUsd??'unavailable',c.summary.activeUsd??'unavailable',c.summary.reservedUsd,c.summary.receiptsUsd,c.summary.feesUsd,c.summary.turnoverUsd,c.summary.userNetOutcomeUsd??'unavailable']);
 return [fields,...rows].map(row=>row.map(quote).join(',')).join('\n')+'\n';
}

/** Count the UTF-8 bytes actually exported, including non-ASCII evidence labels. */
export function capitalReplayJsonBytes(value:unknown):number{
 let bytes=0;for(const character of JSON.stringify(value)){const point=character.codePointAt(0)!;bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}return bytes;
}
