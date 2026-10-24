import {createRequire} from 'node:module';
import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {runCapitalContest,readCapitalContestDetail} from '@coqui/services';
import {openDatabase} from '@coqui/storage';
import {capitalHash} from '@coqui/core';
import type {ChannelResponse} from '@coqui/contracts';
import {contestFixture} from './helpers/capital-contest.js';
import {contestMetricLabel,contestMetricNumber} from '../apps/desktop/src/renderer/app/capital-contest-metrics.js';
const states=vi.hoisted(()=>({} as Record<string,unknown>));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js',()=>({useChannel:(_c:unknown,name:string)=>states[name]??{kind:'loading'}}));
const desktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url)),react=desktop('react') as {createElement:(c:unknown,p:object)=>unknown},server=desktop('react-dom/server') as {renderToStaticMarkup:(e:unknown)=>string};
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root tests omit JSX support.
const {CapitalContestResults,ContestDetail}=await import('../apps/desktop/src/renderer/app/CapitalContestResults.js');
let data:ChannelResponse<'research.capital-contest.detail'>;
beforeAll(async()=>{const {manifest:m,data:panel}=contestFixture(2),db=openDatabase(':memory:');try{await runCapitalContest({manifest:m,loadData:async()=>panel,context:{profileId:m.replay.originProfileId,workspaceId:m.replay.workspaceId,assertCurrent(){}},runtime:{codeRevision:m.replay.codeRevision,sourceManifestHash:m.replay.sourceManifestHash,lockfileHash:m.replay.lockfileHash},now:()=>1,resume:false},db);data=readCapitalContestDetail(m.replay.originProfileId,db,{runId:capitalHash(m),page:0,limit:100,cellId:m.trials[0]!.id});}finally{db.close();}});
beforeEach(()=>{for(const key of Object.keys(states))Reflect.deleteProperty(states,key);});
const render=(component=CapitalContestResults,props:object={})=>server.renderToStaticMarkup(react.createElement(component,{client:{},...props}));
describe('P5 read-only evidence UX',()=>{
 it.each(['loading','failed','blocked','unknown'])('keeps %s explicit',kind=>{states['research.capital-contest.runs']={kind,issues:[{path:[],code:'missing'}]};expect(render()).toContain('Strategy experiments');});
 it('shows the empty separate-profile flow without financial or run controls',()=>{states['research.capital-contest.runs']={kind:'ready',value:{runs:[]}};const html=render();expect(html).toContain('separate empty research profile');for(const label of ['Run','Adopt','Enable','Withdraw'])expect(html).not.toContain(`>${label}<`);});
 it('shows all balances, none, unavailable intervals and concrete assumptions',()=>{const html=render(ContestDetail,{data,page:0,onPage:()=>{},onCell:()=>{}});for(const label of ['$50.00','$100,000.00','Research choice: none','Unavailable','known-lower-bound','Decision evidence','Prospective'])if(label!=='Prospective')expect(html).toContain(label);expect(html).toContain('Next cells');expect(html).toContain('capital-contest-v1');expect(html).toContain('simulation');});
 it('distinguishes period TWR from annual dated IRR and retains exact displayed evidence',()=>{const html=render(ContestDetail,{data,page:0,onPage:()=>{},onCell:()=>{}});expect(html).toContain('Money-weighted annual IRR (ACT/365)');expect(html).toContain('Total time-weighted return (period)');expect(html).toContain('annualized total TWR requires a full year');expect(html).toContain('Exact value:');expect(contestMetricNumber('24.474952665655')).toBe('24.4749…');expect(contestMetricNumber('-0.00000001')).toBe('-0.0000…');expect(contestMetricLabel('worstRolling30ReturnPct')).toBe('Worst complete 30-day NAV return');});
 it('preserves archived/partial/failed status and prevents a missing result becoming a choice',()=>{const html=render(ContestDetail,{data:{...data,run:{...data.run,archived:true,status:'failed',reason:'contest_deadline'},result:null,cells:[]},page:0,onPage:()=>{},onCell:()=>{}});expect(html).toContain('Archived origin');expect(html).toContain('Evaluation incomplete');expect(html).toContain('Missing results are unavailable');expect(html).not.toContain('Research choice: none');});
});
