import type { AppRoute } from './routes.js';

const BOUNDARIES: Partial<Record<AppRoute, {label:string;detail:string}>> = {
  settings:{label:'Local installation · active profile',detail:'Settings and credentials belong to this profile. Verified wallet nicknames are shared locally across profiles.'},
  'portfolio/holdings':{label:'Connected accounts · read only',detail:'Balances cite recorded provider snapshots. Imported accounting lots remain separate. Incomplete valuations remain unavailable.'},
  'portfolio/allocation':{label:'Allocation estimates',detail:'Targets, drift and plans depend on verified accounting evidence. Estimates cannot execute trades.'},
  'portfolio/tax':{label:'Imported accounting evidence',detail:'Cost basis and realized amounts are estimates from recorded lots and disposals. Connected balances do not establish tax basis.'},
  'portfolio/reconciliation':{label:'Snapshot comparison',detail:'Provider balances are compared with ledger records. Differences and missing evidence remain visible.'},
  'paper/overview':{label:'Paper simulations',detail:'Campaigns, parallel evaluations and Alpaca paper balances remain separate. Combined simulations are not wallet-attributed trades.'},
  'paper/orders':{label:'Proposal and execution evidence',detail:'Review stored proposals and their assumptions. Pending or unknown executions require resolution before connector removal.'},
  'paper/performance':{label:'Verified paper valuations',detail:'Performance uses recorded daily simulation evidence. Missing samples and incomplete prices remain unavailable.'},
  strategies:{label:'Shared algorithm evaluations',detail:'Evidence gates and research results describe algorithms. They do not establish account-specific activity or live authority.'},
  research:{label:'Research evidence and lineage',detail:'Runs, prospective studies, reviews and negative findings retain their source hashes and evidence gates.'},
  events:{label:'Validated local imports',detail:'Published and first-known times remain separate for historical replay. Events do not change execution targets.'},
  activity:{label:'Profile-scoped operations',detail:'Runtime status and decision records cite persisted evidence. Account attribution is shown only where recorded.'},
  risk:{label:'Measured risk evidence',detail:'Guardrails use recorded portfolio equity samples. Shared evaluations and paper performance remain separate.'},
};
export function RouteEvidenceBoundary({route}:{readonly route:AppRoute}):React.JSX.Element|null {
  const boundary=BOUNDARIES[route];
  return boundary===undefined?null:<details className="route-evidence-boundary"><summary>{boundary.label}</summary><p>{boundary.detail}</p></details>;
}
