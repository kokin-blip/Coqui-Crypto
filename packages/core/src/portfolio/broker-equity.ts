import { Decimal } from 'decimal.js';
import {reconcileBrokerCash,type BrokerCashEvidence} from './broker-cash.js';

/** Equity changes are observations, not cashflow-adjusted trading returns. */
export function projectBrokerEquity(input:{equityUsd:string;openingEquityUsd:string;cashEvidence?:BrokerCashEvidence;
  history:{points:readonly {atMs:number;equityUsd:string|null}[];cashflows:Readonly<Record<string,readonly (string|null)[]>>|null}}) {
  if(!new Decimal(input.equityUsd).isFinite()||!new Decimal(input.openingEquityUsd).isFinite()||new Decimal(input.openingEquityUsd).lte(0))throw new TypeError('invalid_broker_equity');
  const latest=input.history.points.findLast(point=>point.equityUsd!==null);
  const capitalTypes=new Set(['CSD','CSW','ACATC','ACATS','JNLC','JNLS','JNL','FOPT']);
  let adjustments=new Decimal(0),cashflowComplete=input.history.cashflows!==null;
  // The first nonzero equity observation already includes its opening funding.
  const first=input.history.points.findIndex(point=>point.equityUsd!==null&&!new Decimal(point.equityUsd).isZero());
  if(first<0)cashflowComplete=false;
  for(const [kind,values]of Object.entries(input.history.cashflows??{})){
    if(!capitalTypes.has(kind))continue;
    for(const amount of values.slice(first+1)){if(amount===null)cashflowComplete=false;else adjustments=adjustments.add(amount);}
  }
  const supported=new Set(['JNLC','CSD','CSW','CFEE','FEE']);
  const supportedFlows=Object.entries(input.history.cashflows??{}).every(([kind,values])=>supported.has(kind)||values.every(value=>value!==null&&new Decimal(value).isZero()));
  const openingMatches=first>=0&&new Decimal(input.history.points[first]!.equityUsd!).eq(input.openingEquityUsd);
  const cashReconciliation=cashflowComplete&&supportedFlows&&openingMatches&&input.cashEvidence!==undefined
    ?reconcileBrokerCash(input.cashEvidence,adjustments.toFixed(2),input.openingEquityUsd):null;
  return {equityUsd:new Decimal(input.equityUsd).toFixed(2),openingEquityUsd:new Decimal(input.openingEquityUsd).toFixed(2),
    equityChangeUsd:new Decimal(input.equityUsd).minus(input.openingEquityUsd).toFixed(2),
    historyAtMs:latest?.atMs??null,historyEquityUsd:latest?.equityUsd??null,
    cashAdjustmentsUsd:cashflowComplete?adjustments.toFixed(2):null,
    cashReconciliation,
    netPnlUsd:cashReconciliation?.reconciled?new Decimal(input.equityUsd).minus(input.openingEquityUsd).minus(adjustments).toFixed(2):null,
    netPnlReason:cashReconciliation?.reconciled?'cash_reconciled' as const:cashflowComplete&&!adjustments.isZero()?'cash_adjustments_require_reconciliation' as const:'fill_fee_and_cashflow_reconciliation_required' as const};
}
