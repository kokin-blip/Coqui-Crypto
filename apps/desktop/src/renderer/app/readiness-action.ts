import type { ChannelResponse } from '@coqui/contracts';
import type { ChannelState } from '../query/use-channel.js';

type State<K extends 'app.status-rail'|'parallel.paper.status'|'market-data.live'|'research.edge-study'> = ChannelState<ChannelResponse<K>>;
export function operationalReadinessAction(input: { status: State<'app.status-rail'>; paper: State<'parallel.paper.status'>;
  feed: State<'market-data.live'>; study: State<'research.edge-study'> }) {
  const { status, paper, feed, study } = input;
  const action = (title:string,detail:string,route:string,actionLabel:string) => ({title,detail,route,actionLabel});
  if (status.kind==='ready' && status.value.killSwitchEngaged) return action('Safety stop is engaged',
    'Inspect the recorded safety evidence before considering any change. Live execution remains disabled.','#/operations','Inspect safety evidence');
  if (paper.kind==='ready' && paper.value.reconciliationAttention.blocked) return action('Paper orders need reconciliation',
    'Unresolved order identities or reconciliation failures block new paper orders. Inspect recovery evidence; do not resubmit uncertain orders.','#/settings','Inspect paper recovery');
  if (status.kind!=='ready' || paper.kind!=='ready') return action('Operational evidence is not verified',
    'Safety or paper-reconciliation evidence is loading or unavailable. Inspect the evidence before taking an operational action.','#/operations','Inspect operational evidence');
  if (feed.kind!=='ready' || feed.value.connection!=='live') return action('Current market feed is not verified',
    'The feed is unavailable or disconnected. Inspect its status and timestamps before relying on current observations.','#/markets','Inspect market feed');
  if (study.kind!=='ready' || study.value.status!=='passed') return action('Research qualification is incomplete',
    'Available observations do not establish a qualified strategy. Review registration, coverage and missing evidence.','#/research','Inspect research evidence');
  return action('Inspect the latest decision evidence','Review the recorded decision and any remaining operational gates.','#/activity','Inspect decision evidence');
}

export function evidenceAge(atMs:number|null, nowMs:number):string {
  if(atMs===null) return 'age unknown';
  if(atMs>nowMs) return 'timestamp is in the future; age unverified';
  const seconds=Math.floor((nowMs-atMs)/1000);
  return seconds<60?`${seconds}s old`:seconds<3600?`${Math.floor(seconds/60)}m old`:`${Math.floor(seconds/3600)}h old`;
}

export function researchExplanation(lifecycle:ChannelResponse<'research.edge-study'>['lifecycle']):string {
  return {not_registered:'No qualifying study registration is recorded.',retired_incompatible:'The recorded study does not match the current strategy identity.',
    registered_idle:'A study is registered; eligible collection has not been established.',blocked:'The study is blocked by missing or incompatible evidence.',
    collecting:'Prospective observations are being collected; qualification remains incomplete.',completed:'The study collection period ended. Inspect its result and qualification gates.'}[lifecycle];
}
