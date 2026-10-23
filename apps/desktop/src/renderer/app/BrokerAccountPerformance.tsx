import type {CoquiClient} from '@coqui/contracts';
import {formatUsd} from '@coqui/ui-kit';
import {useChannel} from '../query/use-channel.js';
import {TerminalMetric} from './TerminalPrimitives.js';
import {MetricInfo} from './MetricInfo.js';
import {formatLocalTimestamp} from './time-format.js';
import {CapitalPerformancePanel} from './CapitalPerformance.js';
const money=(value:string)=>formatUsd(value)?.text??value;
export function BrokerAccountPerformance({client,profileId,scopeId,connectionId}:{readonly client:CoquiClient;
  readonly profileId:string;readonly scopeId:string;readonly connectionId:string|null}):React.JSX.Element {
  const state=useChannel(client,'alpaca.paper.performance',{scopeId,connectionId},true,profileId);
  if(state.kind==='loading')return <p className="terminal-algo-caveat">Reading Alpaca account equity and history…</p>;
  if(state.kind!=='ready')return <p className="terminal-algo-caveat">Broker account performance unavailable. Check the Alpaca paper connection.</p>;
  const value=state.value,fillCount=value.cashReconciliation?.fillCount??0;
  return <details className="terminal-algo-broker">
    <summary>Broker account equity · {money(value.equityUsd)}</summary>
    <p className="terminal-algo-caveat">Alpaca paper · ••••{value.accountSuffix} · all assets · read {formatLocalTimestamp(value.asOfMs)}<MetricInfo label="Broker account equity">Cash plus the broker's current valuation of all positions in this Alpaca paper account. This account-wide figure includes cash movements and can differ from the selected orders' P/L. The read time shows when Coqui retrieved it.</MetricInfo></p>
    <dl className="terminal-algo-metrics">
      <TerminalMetric label="Opening equity" info="Alpaca account equity recorded when this Coqui paper experiment started. It is the comparison baseline, not a claim about the account's lifetime deposits.">{money(value.openingEquityUsd)}</TerminalMetric>
      <TerminalMetric label="Equity change since opening" info="Current broker account equity minus opening equity. Deposits, withdrawals and cash adjustments can change this number, so it does not by itself measure trading profit.">{money(value.equityChangeUsd)}</TerminalMetric>
      <TerminalMetric label="Cash adjustments in history" info="Net cash movements reported by the broker after opening funding. Coqui checks these against the USD cash balance, complete fill activity and posted cash fees. A history-only journal can balance the cash ledger even when Alpaca omits its descriptive activity record; this does not identify who initiated it.">{value.cashAdjustmentsUsd===null?'Unproved':money(value.cashAdjustmentsUsd)}</TerminalMetric>
    </dl>
    <CapitalPerformancePanel client={client} provider="alpaca" profileId={profileId} connectionId={connectionId} compact />
    <p className="terminal-algo-caveat">{value.netPnlReason==='cash_reconciled'
      ?`Legacy execution cash proof reconciled · ${fillCount} ${fillCount===1?'fill':'fills'}. Capital performance additionally requires verified flow classification, timing and account coverage.${value.cashReconciliation?.journalDetailsComplete?'':' Journal details are unavailable from Alpaca; the initiator and purpose remain unknown.'}`
      :value.netPnlReason==='cash_adjustments_require_reconciliation'
      ?'Equity includes cash adjustments that need reconciliation. A higher balance does not establish trading profit.'
      :'Net trading P/L requires reconciled fills, fees and cash movements. Broker equity is shown separately.'}</p>
    {value.historyAtMs!==null&&value.historyEquityUsd!==null&&<p className="terminal-algo-caveat">Latest daily history · {money(value.historyEquityUsd)} · {formatLocalTimestamp(value.historyAtMs)}. The current account read can differ.<MetricInfo label="Latest daily history">The most recent daily equity observation returned by Alpaca, at the displayed timestamp. It is a historical snapshot; current positions and prices may have changed since then.</MetricInfo></p>}
  </details>;
}
