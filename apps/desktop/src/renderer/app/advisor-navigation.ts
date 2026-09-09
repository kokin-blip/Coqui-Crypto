import type { ChannelRequest,CoquiClient } from '@coqui/contracts';
import { routeHash,type AppRoute } from './routes.js';

export const ADVISOR_NAVIGATION_EVENT='coqui:advisor-navigation';
export type AdvisorSelection={readonly decisionId:string|null;readonly candidateId:string|null;
  readonly productId:string|null;readonly eventId:string|null;readonly openAdvisor:boolean};

const route:Record<ChannelRequest<'advisor.navigation'>['target'],AppRoute>={activity:'activity',paper:'paper/overview',
  research:'research',risk:'risk',market:'markets',advisor:'markets'};

export async function applyAdvisorNavigation(client:CoquiClient,input:Omit<ChannelRequest<'advisor.navigation'>,'commandId'>) {
  const result=await client.query('advisor.navigation',{commandId:crypto.randomUUID(),...input});
  if(result.status!=='ok') return result;
  const selection:AdvisorSelection={decisionId:result.value.decisionId,candidateId:result.value.candidateId,
    productId:result.value.productId,eventId:result.value.eventId,openAdvisor:result.value.target==='advisor'};
  sessionStorage.setItem(ADVISOR_NAVIGATION_EVENT,JSON.stringify(selection));
  const destination=result.value.eventId===null?route[result.value.target]:'events';
  window.location.hash=routeHash(destination);
  window.dispatchEvent(new CustomEvent(ADVISOR_NAVIGATION_EVENT,{detail:selection}));
  return result;
}

export function savedAdvisorSelection():AdvisorSelection|null {
  try {return JSON.parse(sessionStorage.getItem(ADVISOR_NAVIGATION_EVENT)??'null') as AdvisorSelection|null;} catch{return null;}
}

export function takeAdvisorSelection():AdvisorSelection|null {
  const selection=savedAdvisorSelection();
  sessionStorage.removeItem(ADVISOR_NAVIGATION_EVENT);
  return selection;
}
