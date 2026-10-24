import { useEffect, useId, useState } from 'react';
import type { ChannelRequest, ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { MetricInfo } from './MetricInfo.js';

const money = (value: string | null) => value === null ? 'Unavailable' : formatUsd(value)?.text ?? value;
const EXPLANATIONS: Readonly<Record<string, string>> = { account_ownership_unproven: 'Exclusive account ownership is unverified',
  legacy_writer_conflict: 'Another execution path may be using this account', hold_matching_unknown: 'Open obligations have not been reconciled',
  discretionary_floor_not_met: 'Trade is below the discretionary dollar floor', native_minimum_not_met: 'Rounded quantity is below the native minimum',
  active_nav_unavailable: 'Current portfolio value is incomplete', budget_source_stale: 'Account evidence has expired' };
const reason = (value: string) => EXPLANATIONS[value] ?? value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/gu, '$1 $2');
const timestamp = (atMs: number) => new Date(atMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
function useExpired(expiresAtMs: number | undefined) {
  const [, render] = useState(0);
  useEffect(() => {
    if (expiresAtMs === undefined || Date.now() >= expiresAtMs) return;
    const timer = setTimeout(() => render(value => value + 1), expiresAtMs - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [expiresAtMs]);
  return expiresAtMs !== undefined && Date.now() >= expiresAtMs;
}
export function CapitalFeasibilityResult({ report }: { readonly report: ChannelResponse<'capital.feasibility'> }) {
  const expired = useExpired(report.expiresAtMs);
  return <div className="capital-feasibility-result" aria-live="polite">
    <h4>{report.assurance === 'scenario' ? 'Hypothetical result' : 'Evidence result'}: {expired ? 'expired' : report.state}</h4>
    {expired && <p role="status">Evaluate again for a current result. The observations below retain their original times.</p>}
    <p className="metric-note">Applies to this request only. A feasible result grants no order permission. No minimum starting balance is certified.</p>
    {[...report.reasonCodes, ...report.blocked.flatMap(row => row.reasons), ...report.riskResiduals].length > 0 && <ul>
      {[...new Set([...report.reasonCodes, ...report.blocked.flatMap(row => row.reasons), ...report.riskResiduals])].map(code => <li key={code}>{reason(code)}</li>)}
    </ul>}
    <dl className="metric-grid"><div><dt>Cash left for buys</dt><dd>{money(report.remainingBuyCashUsd)}</dd></div>
      <div><dt>Modeled fees</dt><dd>{money(report.totalFeeUsd)}</dd></div><div><dt>One-way turnover</dt><dd>{money(report.oneWayTurnoverUsd)}</dd></div></dl>
    {report.orders.length > 0 && <div className="terminal-table-scroll" tabIndex={0} role="region" aria-label="Feasible subset of hypothetical trades"><table>
      <caption>Executable subset under the stated assumptions</caption><thead><tr><th scope="col">Side</th><th scope="col">Quantity</th><th scope="col">Cash debit</th><th scope="col">Residual units</th></tr></thead>
      <tbody>{report.orders.map(row => <tr key={`${row.assetId}:${row.side}`}><td>{row.side}</td><td>{row.quantity}</td><td>{money(row.cashDebitUsd)}</td><td>{row.residualQuantity}</td></tr>)}</tbody>
    </table></div>}
    <details><summary>Feasibility evidence</summary><p className="metric-note">{report.version} · evaluated {timestamp(report.evaluatedAtMs)} · expires {timestamp(report.expiresAtMs)}</p>
      <p className="metric-note">Operating floor: unavailable. Recheck the actual retained portfolio before any future reserve proposal.</p>
      <code>{report.id}</code></details>
  </div>;
}
function ObservedBudget({ client, scopeId, mode }: { readonly client: CoquiClient; readonly scopeId: string; readonly mode: string }) {
  const state = useChannel(client, 'capital.budget', { scopeId }, true, `${scopeId}:${mode}`);
  const expired = useExpired(state.kind === 'ready' ? state.value.budget?.expiresAtMs : undefined);
  if (state.kind !== 'ready') return <ChannelNotice state={state} label="Account budget" />;
  const budget = state.value.budget;
  if (!budget) return <p className="metric-note" role="status">Budget evidence has not been recorded. Refresh the existing account source; balances do not establish shared cash ownership.</p>;
  return <div><p className="metric-note">Observed {timestamp(budget.observedAtMs)} · evidence expires {timestamp(budget.expiresAtMs)}</p>
    <dl className="metric-grid"><div><dt>Observed cash</dt><dd>{money(budget.observedCashUsd)}</dd></div>
      <div><dt>Cash after obligations<MetricInfo label="Cash after obligations">Cash and venue eligibility are separate ceilings. Each obligation is deducted only where matching evidence shows it is not already reflected. Unknown ownership, holds or stale evidence make capacity unavailable.</MetricInfo></dt><dd>{mode !== 'active' ? 'Unavailable (historical evidence)' : expired ? 'Unavailable (expired)' : money(budget.spendableUsd)}</dd></div>
      <div><dt>Claim revisions in projection</dt><dd>{budget.claimIds.length}</dd></div></dl>
    {budget.state === 'unavailable' && <p role="status" className="metric-note">Capacity unavailable: {budget.reasonCodes.map(reason).join('; ')}. Refresh and reconcile the named evidence. Current cash stays separately visible.</p>}
    {Object.entries(budget.deficits).map(([asset, amount]) => <p role="status" key={asset}>Unfunded obligation: {amount} {asset}. Existing claims remain recorded.</p>)}
    <details><summary>Budget and native rules</summary><p className="metric-note">{budget.version} · {budget.assurance} · {state.value.nativeRules.length} native rule observations. Account evidence does not enable execution.</p>
      <code>{budget.revision}</code>{state.value.nativeRules.map(rule => <p className="metric-note" key={rule.id}>{rule.provider} · {rule.productId} · {rule.quantityMin.state === 'known' ? `Minimum ${rule.quantityMin.value} ${rule.baseCurrency}` : 'Minimum unknown'} · {rule.quantityIncrement.state === 'known' ? `Increment ${rule.quantityIncrement.value}` : 'Increment unknown'}</p>)}</details>
  </div>;
}
function CapitalScenario({ client }: { readonly client: CoquiClient }) {
  const id = useId(), [capital, setCapital] = useState('500'), [trade, setTrade] = useState('25');
  const [evaluation, setEvaluation] = useState(0);
  const [request, setRequest] = useState<ChannelRequest<'capital.feasibility'> | null>(null);
  const state = useChannel(client, 'capital.feasibility', request ?? { mode: 'scenario', scopeId: null, capitalUsd: '500', tradeUsd: '25', minimumQuantity: '0.01', quantityIncrement: '0.01' }, request !== null, `${id}:${evaluation}`);
  const valid = [capital, trade].every(value => /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/u.test(value));
  return <details className="capital-scenario"><summary>Explore a small starting balance</summary>
    <p className="metric-note">Hypothetical USD cash book and a $1 illustrative asset. Fixed 5% entry limit, 20% position cap, 90% invested cap, 16% turnover limit and $25 discretionary floor. Native minimum and increment: 0.01 units.</p>
    <p className="metric-note">Assumed fee: 0.25% of the received asset; bid/ask: $0.999/$1.001; slippage: 15 basis points; fixed fee and additional impact: $0. These assumptions are not current account terms or a return forecast. Smaller trades do not reduce a proportional fee rate.</p>
    <form onSubmit={event => { event.preventDefault(); if (valid) { setEvaluation(value => value + 1); setRequest({ mode: 'scenario', scopeId: null, capitalUsd: capital, tradeUsd: trade, minimumQuantity: '0.01', quantityIncrement: '0.01' }); } }}>
      <label htmlFor={`${id}-capital`}>Starting cash (USD)<input id={`${id}-capital`} inputMode="decimal" value={capital} onChange={event => { setCapital(event.target.value); setRequest(null); }} /></label>
      <label htmlFor={`${id}-trade`}>Desired trade (USD)<input id={`${id}-trade`} inputMode="decimal" value={trade} onChange={event => { setTrade(event.target.value); setRequest(null); }} /></label>
      <button type="submit" className="button-secondary" disabled={!valid}>Evaluate scenario</button>{!valid && <p role="status">Enter nonnegative decimal dollar amounts, with up to eight decimal places.</p>}
    </form>
    {request !== null && (state.kind === 'ready' ? <CapitalFeasibilityResult report={state.value} /> : <ChannelNotice state={state} label="Hypothetical feasibility" />)}
  </details>;
}
export function CapitalFeasibility({ client }: { readonly client: CoquiClient }) {
  const id = useId(), [selected, setSelected] = useState('');
  const catalog = useChannel(client, 'capital.scopes', {});
  const entries = catalog.kind === 'ready' ? catalog.value.scopes : [];
  const active = entries.filter(row => row.mode === 'active');
  const scope = entries.find(row => row.scope.id === selected) ?? (active.length === 1 ? active[0] : undefined);
  return <section className="capital-feasibility capital-performance space-y-4" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Capital feasibility</h3><p className="metric-note">Inspect one account’s cash, obligations and trade constraints. This view reads local evidence.</p>
    {catalog.kind !== 'ready' ? <ChannelNotice state={catalog} label="Budget accounts" /> : entries.length === 0 ?
      <p className="metric-note">No verified account or paper opening is recorded. Hypothetical scenarios are available below.</p> : <>
        {(entries.length > 1 || !scope) && <label htmlFor={`${id}-scope`}>Budget account<select id={`${id}-scope`} value={scope?.scope.id ?? ''} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose an account</option>{entries.map(row => <option key={row.scope.id} value={row.scope.id}>{row.label} · {row.mode}</option>)}</select></label>}
        {scope ? <ObservedBudget key={`${scope.scope.id}:${scope.mode}`} client={client} scopeId={scope.scope.id} mode={scope.mode} /> : <p className="metric-note">Choose one account to inspect its evidence.</p>}
      </>}
    <CapitalScenario client={client} />
  </section>;
}
