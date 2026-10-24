import { useEffect, useId, useRef, useState } from 'react';
import { reserveSettingsSchema, type ChannelRequest, type ChannelResponse, type CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { CapitalMetricValue } from './CapitalPerformance.js';
import { MetricInfo } from './MetricInfo.js';

type Settings=ChannelRequest<'capital.reserve.settings.save'>['settings'];
type Inspection=ChannelResponse<'capital.reserve.preview'>;
type Financial=Inspection['report']['financial'];
const defaults=(scenario=false):Settings=>({goal:scenario?'preview':'keep_invested',trigger:{kind:'profit_usd',value:'50'},shareBps:scenario?2500:0,retainedCapitalUsd:scenario?'500':'0',minimumBatchUsd:'1',cadence:'manual',reviewWinCount:null,taxHold:{amountUsd:'0',backing:'principal'}});
const timestamp=(at:number)=>new Date(at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'});
const human=(code:string)=>code.replaceAll('_',' ').replace(/([a-z])([A-Z])/gu,'$1 $2');
const usd=(value:string|null)=>value===null?'Unavailable':formatUsd(value)?.text??value;
function useExpired(expiresAtMs:number){const[,tick]=useState(0);useEffect(()=>{if(Date.now()>=expiresAtMs)return;const timer=setTimeout(()=>tick(n=>n+1),expiresAtMs-Date.now()+1);return()=>clearTimeout(timer);},[expiresAtMs]);return Date.now()>=expiresAtMs;}
function SettingsFields({settings:s,onChange,disabled=false}:{readonly settings:Settings;readonly onChange:(settings:Settings)=>void;readonly disabled?:boolean}){
  const id=useId(),set=(change:Partial<Settings>)=>onChange({...s,...change});
  return <fieldset className="reserve-fields" disabled={disabled}><legend>Preview preferences</legend>
    <label htmlFor={`${id}-goal`}>Goal<select id={`${id}-goal`} value={s.goal} onChange={e=>set({goal:e.target.value as Settings['goal']})}><option value="keep_invested">Keep gains invested</option><option value="preview">Preview setting aside gains</option></select></label>
    <label htmlFor={`${id}-trigger`}>Milestone<select id={`${id}-trigger`} value={s.trigger.kind} onChange={e=>set({trigger:{kind:e.target.value as Settings['trigger']['kind'],value:e.target.value==='growth_bps'?'1000':'50'}})}><option value="profit_usd">New dollar profit</option><option value="growth_bps">Growth from fixed base</option><option value="balance_usd">Active balance target</option></select></label>
    <label htmlFor={`${id}-threshold`}>{s.trigger.kind==='growth_bps'?'Growth milestone (%)':'Milestone (USD)'}<input id={`${id}-threshold`} inputMode="decimal" value={s.trigger.kind==='growth_bps'?Number(s.trigger.value)/100:s.trigger.value} onChange={e=>set({trigger:{...s.trigger,value:s.trigger.kind==='growth_bps'?String(Math.round(Number(e.target.value)*100)):e.target.value}})} /></label>
    <label htmlFor={`${id}-share`}>Share of eligible profit (%)<input id={`${id}-share`} type="number" min="0" max="100" step="0.01" value={s.shareBps/100} onChange={e=>set({shareBps:Math.round(Number(e.target.value)*100)})} /></label>
    <label htmlFor={`${id}-floor`}>Retained capital preference (USD)<input id={`${id}-floor`} inputMode="decimal" value={s.retainedCapitalUsd} onChange={e=>set({retainedCapitalUsd:e.target.value})} /></label>
    <label htmlFor={`${id}-batch`}>Minimum reserve batch (USD)<input id={`${id}-batch`} inputMode="decimal" value={s.minimumBatchUsd} onChange={e=>set({minimumBatchUsd:e.target.value})} /></label>
    <label htmlFor={`${id}-cadence`}>Review reminder preference<select id={`${id}-cadence`} value={s.cadence} onChange={e=>set({cadence:e.target.value as Settings['cadence']})}><option value="manual">Manual inspection</option><option value="daily">Every day</option><option value="weekly">Every 7 days</option><option value="monthly">Every 30 days</option></select></label>
    <label htmlFor={`${id}-wins`}>Optional completed wins for review<input id={`${id}-wins`} type="number" min="1" max="10000" step="1" value={s.reviewWinCount??''} onChange={e=>set({reviewWinCount:e.target.value===''?null:Number(e.target.value)})} /></label>
    <label htmlFor={`${id}-tax`}>Hypothetical tax hold (USD)<input id={`${id}-tax`} inputMode="decimal" value={s.taxHold.amountUsd} onChange={e=>set({taxHold:{...s.taxHold,amountUsd:e.target.value}})} /></label>
    <label htmlFor={`${id}-tax-source`}>Tax hold funding<select id={`${id}-tax-source`} value={s.taxHold.backing} onChange={e=>set({taxHold:{...s.taxHold,backing:e.target.value as Settings['taxHold']['backing']}})}><option value="principal">Principal</option><option value="profit">Investment profit</option><option value="unknown">Not established</option></select></label>
  </fieldset>;
}
function FinancialMetrics({financial:f}:{readonly financial:Financial}){
  const expired=useExpired(f.expiresAtMs);
  const rows:[keyof Financial,string][]=[['openingEquityUsd','Economic opening'],['equityUsd','Total account equity'],['observedCashUsd','Observed account cash'],['activeEquityUsd','Active trading equity'],['spendableUsd','Free cash after obligations'],['contributionsUsd','External contributions since opening'],['economicPnlUsd','Contribution-adjusted economic profit'],['realizedPnlUsd','Scoped realized investment profit'],['unrealizedPnlUsd','Scoped unrealized profit'],['feesUsd','Attributed account fees'],['incomeUsd','Attributed investment income'],['actualReservedUsd','Actual Coqui profit reserve (part of equity)'],['actualTaxHoldUsd','Actual Coqui tax hold (part of equity)'],['actualPendingUsd','Pending transfer value'],['confirmedReceiptsUsd','Confirmed external receipts (outside equity)']];
  return <><p className="metric-note">Performance cut: {f.toMs===null?'unavailable':timestamp(f.toMs)}. Budget observed: {f.observedAtMs===null?'unavailable':timestamp(f.observedAtMs)}; expires {timestamp(f.expiresAtMs)}.{expired?' Cash capacity is unavailable until fresh evidence is reconciled.':''}</p><dl className="metric-grid">{rows.map(([key,label])=>{const metric=f[key];return typeof metric==='object'&&metric!==null&&'state' in metric?<div key={key}><dt>{label}</dt><dd>{key==='spendableUsd'&&expired?'Unavailable (expired)':<CapitalMetricValue value={metric} label={label} />}</dd></div>:null;})}</dl></>;
}
export function ProfitReserveResult({inspection}:{readonly inspection:Inspection}){
  const r=inspection.report,expired=useExpired(r.expiresAtMs);
  return <section className="reserve-result" aria-label="Profit reserve preview result" aria-live="polite">
    <h4 tabIndex={-1}>Preview consequence: {expired?'expired':r.state}</h4>
    <p className="metric-note">{r.assurance==='scenario'?'Independent hypothetical book':'Recorded account evidence'} · evaluated {timestamp(r.evaluatedAtMs)} · expires {timestamp(r.expiresAtMs)}.</p>
    <p>No cash was reserved. Selling into cash and money received by the user are separate events.</p>
    {expired&&<p role="status">This is historical evidence. Evaluate again for a current consequence.</p>}
    {r.reasonCodes.length>0&&<ul>{r.reasonCodes.map(code=><li key={code}>{human(code)}</li>)}</ul>}
    <dl className="metric-grid"><div><dt>{expired?'Previously modeled reserve':'Additional modeled reserve'}<MetricInfo label="Additional modeled reserve">A share of new economic profit, capped by net realized profit, available cash and a supported retained-capital requirement. This preview moves no account cash.</MetricInfo></dt><dd><CapitalMetricValue value={r.reserveUsd} label="Additional modeled reserve" /></dd></div>
      <div><dt>Retained active equity after modeled holds</dt><dd><CapitalMetricValue value={r.retainedActiveUsd} label="Retained active equity" /></dd></div>
      <div><dt>Fixed assessment base</dt><dd>{usd(r.baseUsd)}</dd></div><div><dt>Current cycle profit ceiling</dt><dd>{usd(r.cycleCeilingUsd)}</dd></div>
      <div><dt>Modeled assessed-profit baseline</dt><dd>{usd(r.modeledHUsd)}</dd></div><div><dt>Prior gains excluded by this policy</dt><dd>{usd(r.excludedProfitUsd)}</dd></div></dl>
    <details><summary>Inspect caps, accounting and provenance</summary>
      <p className="metric-note">The percentage milestone uses the fixed dollar base above, not time-weighted return. Win counts can request a review; they cannot establish eligible profit.</p>
      <FinancialMetrics financial={r.financial} />
      <dl className="metric-grid">{Object.entries(r.caps).map(([key,metric])=>{const label=({economicUsd:'Economic profit cap (USD)',realizedUsd:'Realized profit cap (USD)',cashUsd:'Cash cap (USD)',capitalUsd:'Retained-capital cap (USD)'} as Record<string,string>)[key]!;return <div key={key}><dt>{label}</dt><dd><CapitalMetricValue value={metric} label={label} /></dd></div>;})}
        <div><dt>Profit slice newly assessed in the model</dt><dd><CapitalMetricValue value={r.assessedProfitUsd} label="Modeled assessed profit slice" /></dd></div>
        <div><dt>Retained-capital requirement</dt><dd><CapitalMetricValue value={r.operatingRequirement.floorUsd} label="Retained-capital requirement" /></dd></div>
        <div><dt>Fractional-cent rounding difference</dt><dd><CapitalMetricValue value={r.roundingResidualUsd} label="Rounding difference" unit="ratio" /> USD</dd></div></dl>
      <p className="metric-note">Requirement objective: {human(r.operatingRequirement.objective)}. Cash-only examples do not certify capacity for future trades. A fixed-plan witness applies only to its exact portfolio, rules, costs and request; it cannot guarantee a future capital floor.</p>
      <p className="metric-note">Tracking {r.financial.fromMs===null?'unavailable':timestamp(r.financial.fromMs)} through {r.financial.toMs===null?'unavailable':timestamp(r.financial.toMs)}. {r.financial.trackingLimitations.join(' ')}</p>
      <p className="metric-note">{r.version} · profit-reserve-eligibility-v1 · capital-flow-performance-v1. Values are before personal taxes. A tax hold is a preference, not a tax liability estimate. Fiat USD and stablecoins differ.</p>
      <p className="metric-note">Input hash <code>{r.inputHash}</code></p><p className="metric-note">Policy <code>{r.policyId}</code> · state <code>{r.stateId}</code></p>
      <details><summary>Exact preview inputs</summary><pre>{r.inputsJson}</pre></details>
      <p className="metric-note">Evidence references: {r.evidenceRefs.length}. Missing historical facts require their original evidence; another screen refresh cannot reconstruct them.</p>
    </details>
    <details><summary>Cash shortfall and hypothetical sale</summary><p className="metric-note">A sale consequence never funds this preview. Sale proceeds include returned principal; only the reconciled gain is investment profit.</p>
      <dl className="metric-grid"><div><dt>Would require sale cash</dt><dd><CapitalMetricValue value={inspection.sale.requiredCashUsd} label="Required sale cash" /></dd></div>
        {(['saleNotionalUsd','modeledCostUsd','realizedGainUsd','residualPositionUsd','accountCashAfterSaleUsd','turnoverUsd'] as const).map(key=><div key={key}><dt>{human(key)}</dt><dd><CapitalMetricValue value={inspection.sale[key]} label={human(key)} /></dd></div>)}</dl>
      {inspection.sale.reasonCodes.length>0&&<p role="status">{inspection.sale.reasonCodes.map(human).join('; ')}.</p>}
      <p className="metric-note">Illustration before costs: with $500 basis and $550 value, selling $12.50 realizes about $1.14. Realizing $12.50 under proportional basis requires a $137.50 sale. This is not broker tax-lot identification.</p>
    </details>
    <details><summary>Compare hypothetical upside and downside</summary><div className="terminal-table-scroll" role="region" tabIndex={0} aria-label="Hypothetical reserve comparison"><table><caption>Modeled total outcomes in USD; no probabilities</caption><thead><tr><th scope="col">Market move</th><th scope="col">Keep invested</th><th scope="col">Keep reserve</th><th scope="col">User net invested</th><th scope="col">User net reserve</th></tr></thead>
      <tbody>{inspection.comparison.map(row=><tr key={row.marketMoveBps}><th scope="row">{row.marketMoveBps/100}%</th>{(['investedOutcomeUsd','reserveOutcomeUsd','userNetInvestedUsd','userNetReserveUsd'] as const).map(k=><td key={k}><CapitalMetricValue value={row[k]} label={`${row.marketMoveBps/100}% ${human(k)}`} /></td>)}</tr>)}</tbody></table></div><ul>{inspection.comparisonAssumptions.map(note=><li key={note}>{note}</li>)}</ul></details>
    <p className="metric-note">{r.wouldRequestReview?'A win-count review condition is met. No notification was sent. ':''}{inspection.nextReviewAtMs===null?'Manual inspection preference.':`Next advisory review: ${timestamp(inspection.nextReviewAtMs)}.`} No background review is scheduled.</p>
  </section>;
}
function AccountReserve({client,scopeId,active}:{readonly client:CoquiClient;readonly scopeId:string;readonly active:boolean}){
  const view=useChannel(client,'capital.reserve.view',{scopeId},true,scopeId);
  if(view.kind!=='ready')return <ChannelNotice state={view} label="Profit reserve evidence" />;
  return <AccountReserveEditor key={scopeId} client={client} view={view.value} active={active} />;
}
function AccountReserveEditor({client,view,active}:{readonly client:CoquiClient;readonly view:ChannelResponse<'capital.reserve.view'>;readonly active:boolean}){
  const [settings,setSettings]=useState<Settings>(()=>view.policy?.settings??defaults()),[draft,setDraft]=useState<ChannelRequest<'capital.reserve.preview'>|null>(null),[evaluation,setEvaluation]=useState(0),[notice,setNotice]=useState('');
  const message=useRef<HTMLParagraphElement>(null),result=useRef<HTMLDivElement>(null);
  const save=useCommand(client,'capital.reserve.settings.save',['capital.reserve.view']),inspect=useCommand(client,'capital.reserve.inspect',['capital.reserve.view']);
  const preview=useChannel(client,'capital.reserve.preview',draft??{mode:'observed',scopeId:view.scopeId},draft!==null,`${view.scopeId}:${evaluation}`);
  useEffect(()=>{setSettings(view.policy?.settings??defaults());setDraft(null);},[view.policy?.id]);
  useEffect(()=>{setDraft(null);},[view.financial.sourceCutHash]);
  const valid=reserveSettingsSchema.safeParse(settings).success,pending=save.state.kind==='pending'||inspect.state.kind==='pending',unknown=save.state.kind==='unknown'||inspect.state.kind==='unknown';
  const canWrite=active&&!view.archived&&!pending&&!unknown&&view.financial.sourceCutHash!==null;
  const savedMatches=view.policy!==null&&JSON.stringify(view.policy.settings)===JSON.stringify(settings);
  const commandBase=()=>({commandId:crypto.randomUUID(),scopeId:view.scopeId,expectedPolicyId:view.policy?.id??null,expectedStateId:view.state?.id??null,expectedInputHash:view.financial.sourceCutHash!});
  const change=(s:Settings)=>{setSettings(s);setDraft(null);setNotice('');};
  const showNotice=(text:string)=>{setNotice(text);setTimeout(()=>message.current?.focus(),0);};
  return <div className="reserve-account"><FinancialMetrics financial={view.financial} />
    {(!active||view.archived)&&<p role="status">Archived or disconnected evidence. Preview settings cannot be changed for this scope.</p>}
    <SettingsFields settings={settings} onChange={change} disabled={pending||unknown||!active||view.archived} />
    <p className="metric-note">Review cadence and completed-win counts are advisory preferences. Settings cannot enable a scheduler, reserve or withdrawal.</p>
    {!valid&&<p role="alert">Enter valid dollar amounts with up to two decimal places, a positive milestone and batch, and a profit share from 0% to 100%.</p>}
    <div className="reserve-actions"><button type="button" className="button-secondary" disabled={!valid||pending||unknown} onClick={()=>{setDraft({mode:'observed',scopeId:view.scopeId,settings});setEvaluation(n=>n+1);}}>Evaluate draft</button>
      <button type="button" className="button-secondary" disabled={!valid||!canWrite} onClick={()=>{void save.run({...commandBase(),settings}).then(o=>showNotice(o.status==='ok'?'Preview settings saved. No cash was reserved.':'Preview settings were not confirmed. Reload current evidence before retrying.'));}}>Save preview settings</button>
      <button type="button" className="button-secondary" disabled={!savedMatches||!canWrite||!view.state} onClick={()=>{void inspect.run(commandBase()).then(o=>{if(o.status==='ok'){setDraft(null);showNotice('Calculation recorded as preview evidence. No assessment was applied.');setTimeout(()=>result.current?.querySelector<HTMLElement>('h4')?.focus(),0);}else showNotice('Calculation was not confirmed. Reload current evidence and inspect the revised scope.');});}}>Inspect calculation</button></div>
    <p ref={message} tabIndex={-1} role="status">{pending?'Recording local preview evidence…':notice}</p>
    {unknown&&<p role="status">Completion is unknown. Refresh current account evidence to inspect the durable result before another command.</p>}
    {[save.state,inspect.state].map((s,n)=>s.kind==='failed'||s.kind==='blocked'?<p role="alert" key={n}>{s.codes.map(human).join('; ')}. Reload the current policy and financial evidence.</p>:null)}
    <div ref={result}>{draft!==null?(preview.kind==='ready'?<ProfitReserveResult inspection={preview.value} />:<ChannelNotice state={preview} label="Draft reserve preview" />):inspect.value&&notice.startsWith('Calculation recorded')?<ProfitReserveResult inspection={inspect.value} />:view.latest?<details><summary>Last recorded preview (historical evidence)</summary><ProfitReserveResult inspection={view.latest} /></details>:null}</div>
    <p className="metric-note">{view.state?.baseline==='awaiting_evidence'?'The saved configuration is waiting for a supported financial baseline. No missing amount became zero.':''} <a href="#/paper/performance">View cash-flow-correct performance</a> · <a href="#/research">Open research evidence</a></p>
  </div>;
}
function ReserveScenario({client}:{readonly client:CoquiClient}){
  const result=useRef<HTMLDivElement>(null);
  const id=useId(),[settings,setSettings]=useState<Settings>(()=>defaults(true)),[opening,setOpening]=useState('500'),[profit,setProfit]=useState('50'),[realized,setRealized]=useState('50'),[cash,setCash]=useState('550'),[expense,setExpense]=useState('0');
  const [request,setRequest]=useState<ChannelRequest<'capital.reserve.preview'>|null>(null),[evaluation,setEvaluation]=useState(0);
  const state=useChannel(client,'capital.reserve.preview',request??{mode:'scenario',openingUsd:'500',profitUsd:'50',realizedProfitUsd:'50',cashUsd:'550',externalExpenseUsd:'0',settings},request!==null,`${id}:${evaluation}`);
  useEffect(()=>{if(request!==null&&state.kind!=='loading') (result.current?.querySelector<HTMLElement>('h4')??result.current)?.focus();},[state.kind,evaluation,request]);
  const valid=reserveSettingsSchema.safeParse(settings).success&&[opening,cash,expense].every(v=>/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/u.test(v))&&[profit,realized].every(v=>/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/u.test(v));
  const edit=(set:(value:string)=>void)=>(value:string)=>{set(value);setRequest(null);};
  return <details className="reserve-scenario"><summary>Explore a hypothetical $500 book</summary><p>Independent scenario, not account money. Assume $0 historical booked fees; any modeled sale uses 0.25% received-side fees, a 0.1% bid/ask distance, 15 basis points of slippage and $0 fixed cost. A cash-only goal does not certify future strategy trades.</p>
    <form onSubmit={e=>{e.preventDefault();if(valid){setRequest({mode:'scenario',openingUsd:opening,profitUsd:profit,realizedProfitUsd:realized,cashUsd:cash,externalExpenseUsd:expense,settings});setEvaluation(n=>n+1);}}}>
      <fieldset className="reserve-fields"><legend>Hypothetical financial facts (USD)</legend>{[['opening','Opening cash',opening,edit(setOpening)],['profit','Total economic profit / loss',profit,edit(setProfit)],['realized','Net realized investment profit / loss',realized,edit(setRealized)],['cash','Current account cash',cash,edit(setCash)],['expense','Outside-account expense',expense,edit(setExpense)]].map(([key,label,value,set])=><label key={String(key)} htmlFor={`${id}-${String(key)}`}>{String(label)}<input id={`${id}-${String(key)}`} inputMode="decimal" value={value as string} onChange={e=>(set as (s:string)=>void)(e.target.value)} /></label>)}</fieldset>
      <SettingsFields settings={settings} onChange={s=>{setSettings(s);setRequest(null);}} />
      <button className="button-secondary" type="submit" disabled={!valid}>Evaluate hypothetical reserve</button>{!valid&&<p role="alert">Use valid amounts with up to two decimal places, a positive opening and milestone, and a share between 0% and 100%.</p>}
    </form><div ref={result} tabIndex={-1}>{request!==null&&(state.kind==='ready'?<ProfitReserveResult inspection={state.value} />:<ChannelNotice state={state} label="Hypothetical reserve" />)}</div>
  </details>;
}
export function ProfitReserves({client}:{readonly client:CoquiClient}){
  const id=useId(),[selected,setSelected]=useState(''),catalog=useChannel(client,'capital.scopes',{}),entries=catalog.kind==='ready'?catalog.value.scopes:[],active=entries.filter(e=>e.mode==='active');
  const scope=entries.find(e=>e.scope.id===selected)??(active.length===1?active[0]:undefined);
  return <section className="profit-reserves capital-performance" aria-labelledby={`${id}-title`}><h3 id={`${id}-title`}>Profit reserves</h3><p>Preview a share of previously unassessed investment gains while preserving operating capital. Default account behavior remains keep gains invested.</p>
    {catalog.kind!=='ready'?<ChannelNotice state={catalog} label="Reserve accounts" />:entries.length===0?<p>No verified account is available. Explore an independent hypothetical book below.</p>:<><label htmlFor={`${id}-account`}>Account and environment<select id={`${id}-account`} value={scope?.scope.id??''} onChange={e=>setSelected(e.target.value)}><option value="">Choose one account</option>{entries.map(e=><option key={e.scope.id} value={e.scope.id}>{e.label} · {e.scope.environment} · {e.mode}</option>)}</select></label>
      {scope?<p className="metric-note">{scope.label} · {scope.scope.environment} · {scope.mode} · USD</p>:<p>Select an account to inspect its own evidence.</p>}{scope&&<AccountReserve key={scope.scope.id} client={client} scopeId={scope.scope.id} active={scope.mode==='active'} />}</>}
    <ReserveScenario client={client} /></section>;
}
