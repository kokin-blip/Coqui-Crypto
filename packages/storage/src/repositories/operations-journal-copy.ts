import type { OperationsActivityStatus, OperationsFacts, OperationsWorker } from './operations-activity.js';

const REASONS: Readonly<Record<string,string>> = {
  no_intents:'no paper orders were needed', no_rebalance_needed:'the allocation did not need rebalancing',
  kill_switch_engaged:'the safety stop is engaged', stale_market_data:'the market data is stale',
  market_fetch_failed:'the market data could not be refreshed', insufficient_history:'there is not enough completed history',
  stale_product_rules:'the product rules are stale', gates_refused:'the execution checks refused the plan',
  evidence_not_verified:'the required evidence has not been verified', paper_execution_off:'paper execution is turned off',
  risk_hard_stop:'the risk controls require a stop', execution_unknown:'the execution outcome is unconfirmed',
  all_intents_filtered:'the execution checks filtered out all proposed orders', human_review_required:'the plan needs human review',
  execution_failed:'the paper execution failed', pending_settlement:'the paper orders are awaiting settlement',
  deadline_exceeded:'the operation reached its deadline', timed_out:'the operation timed out',
};
export function operationsReason(reason: unknown): string {
  if (typeof reason !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(reason)) return 'no specific reason was recorded';
  return REASONS[reason] ?? `the recorded reason is ${reason.replaceAll('_',' ')}`;
}
export function operationsMessage(worker: OperationsWorker, phase: string, status: OperationsActivityStatus,
  facts: OperationsFacts): string {
  const instruments=typeof facts.instruments==='string'&&facts.instruments.length>0?` ${facts.instruments}`:'';
  const reason=operationsReason(facts.reasonCode);
  if (status==='unknown' && phase.endsWith('_started')) return 'I started this work; its current state is unconfirmed.';
  if (worker==='host') {
    if(phase==='paper_pass_started')return status==='running'?'I’m coordinating this paper check.':'I started this paper check.';
    if(phase==='paper_pass_finished')return status==='waiting'?'I finished this paper check. Paper orders still need reconciliation.':status==='blocked'?'I finished the paper check. New orders remain paused.':status==='failed'?'My paper check did not complete.':status==='unknown'?'My paper check’s current outcome is unconfirmed.':'I finished this paper check.';
    if (phase==='evaluation_started') return status==='running'?'I’m coordinating this paper evaluation.':'I started this paper evaluation.';
    if (phase==='evaluation_finished') return facts.reasonCode==='pending_settlement'?'I finished the evaluation. Paper settlement is still pending.':
      facts.reasonCode?`I finished the evaluation: ${reason}.`:'I finished this paper evaluation.';
    if (phase==='no_trade') return `I recorded no trade: ${reason}.`;
    if (phase==='stand_down') return `I stood down because ${reason}.`;
    if (phase==='lease_acquired') return 'I acquired scheduler coordination. This does not establish an evaluation start.';
    if (phase==='lease_released') return 'I released scheduler coordination.';
    if (phase==='lease_lost') return 'I lost scheduler coordination.';
    if (phase==='lease_cancelled') return 'My scheduler coordination was cancelled.';
    if (phase==='paused') return `I paused new paper orders because ${reason}.`;
    if (phase==='resumed') return 'I recorded the paper workflow resuming.';
    if (phase==='stopped') return 'I recorded the paper workflow stopping.';
  }
  if (worker==='market') {
    if (phase==='market_refresh_started') return status==='running'?`I’m checking${instruments || ' the selected instruments'} using completed candles.`:
      `I started checking${instruments || ' the selected instruments'} using completed candles.`;
    if (phase==='market_refresh_finished') return status==='completed'?`I refreshed completed-candle evidence for${instruments || ' the selected instruments'}.`:
      `I could not confirm fresh market evidence because ${reason}.`;
    if (phase==='dataset_checked') return `I checked${instruments || ' the evaluation dataset'}: recorded market evidence was ${facts.freshness ?? 'unavailable'}.`;
    if (phase==='decision') return 'I recorded the parallel paper allocation targets from the completed decision dataset.';
  }
  if (worker==='risk') {
    if(status==='failed')return 'My execution-rule check failed. No approval is confirmed.';
    if(status==='unknown')return 'I could not confirm this paper plan’s execution-rule outcome.';
    if (phase==='gates_started') return status==='running'?'I’m checking this paper plan’s execution rules.':'I started checking this paper plan’s execution rules.';
    if (status==='completed') return 'I approved this paper plan under the recorded execution checks.';
    if (phase==='eligibility') return `I refused paper planning because ${reason}. Execution gates were not run.`;
    return `I blocked this paper plan because ${reason}.`;
  }
  if (worker==='research') {
    if (status==='running') return 'I’m running this research job. No result is ready yet.';
    if (phase==='worker_started') return status==='unknown'?'I started this research attempt; its current state is unconfirmed.':'I started this research attempt.';
    if (status==='waiting') return 'My research job is queued and waiting for a worker.';
    if (status==='completed') return 'I finished this research job. Its recorded result is ready to inspect.';
    if (status==='cancelled') return 'My research job was cancelled.';
    if (status==='failed') return `My research attempt failed: ${reason}.`;
    return 'My research job’s current state is unconfirmed.';
  }
  if (worker==='execution') {
    if (phase==='execution_planned'||phase==='external_intent') return 'I recorded a paper execution plan. It is not a confirmed submission.';
    if (phase==='execution_submitted') return 'I submitted the paper orders. Their fills are not confirmed yet.';
    if (phase==='submit_attempt') return 'I recorded an Alpaca paper submission attempt. Its acknowledgement must be checked.';
    if (phase==='external_order') return 'I recorded an Alpaca paper order update. This update alone does not establish a fill.';
    if (phase==='execution_filled') return `I recorded paper settlement${facts.filledCount===undefined?'':` with ${facts.filledCount} confirmed fill(s)`}.`;
    if (phase==='external_fill') return 'I recorded a confirmed Alpaca paper fill.';
    if (phase==='local_fill') return 'I recorded a fill in the local parallel paper simulation.';
    if (phase==='execution_refused') return `I recorded a paper execution refusal because ${reason}.`;
    if (phase==='recovery') return 'I recorded a paper recovery outcome. Inspect the source evidence for its disposition.';
    if (phase==='external_complete'||phase==='intraday_complete') return 'I recorded the paper execution pass completing.';
    if (phase==='reconciliation_error') return `My paper reconciliation failed because ${reason}.`;
  }
  if (worker==='advisor') {
    if (phase==='explanation_started') return status==='running'?'I’m preparing an explanation from the recorded evidence.':'I started preparing an evidence-bound explanation.';
    if (phase==='navigation') return status==='completed'?'I opened the requested evidence context.':`I refused that navigation because ${reason}.`;
    if (status==='completed'&&facts.reasonCode==='provider_failed')return 'I prepared a local response after the provider failed.';
    if (status==='completed') return facts.operation==='chat'?'I completed the requested advisory response.':'I completed the requested evidence explanation.';
    if (status==='failed') return 'My requested advisory operation failed. Inspect the recorded outcome.';
    if (status==='cancelled') return 'My requested advisory operation was cancelled.';
  }
  return status==='failed'?`My recorded operation failed: ${reason}.`:
    status==='blocked'?`I could not proceed because ${reason}.`:'I recorded an operation update. Technical evidence is available.';
}
