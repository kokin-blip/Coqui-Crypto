import {createRequire} from 'node:module';
import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {readCapitalReplayDetail,runCapitalReplay} from '@coqui/services';import {openDatabase} from '@coqui/storage';import {capitalHash} from '@coqui/core';
import type {ChannelResponse} from '@coqui/contracts';import {replayFixture} from './helpers/capital-replay.js';
const states=vi.hoisted(()=>({} as Record<string,unknown>));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js',()=>({useChannel:(_c:unknown,name:string)=>states[name]??{kind:'loading'}}));
const desktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url)),react=desktop('react') as {createElement:(c:unknown,p:object)=>unknown},server=desktop('react-dom/server') as {renderToStaticMarkup:(e:unknown)=>string};
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root tests omit JSX support.
const {CapitalReplayResults,ReplayDetail}=await import('../apps/desktop/src/renderer/app/CapitalReplayResults.js');
let data:ChannelResponse<'research.capital-replay.detail'>;
beforeAll(async()=>{const {spec,tape}=replayFixture(),db=openDatabase(':memory:');try{await runCapitalReplay({spec,loadTape:async()=>tape,context:{profileId:spec.originProfileId,workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>1,retry:false},db);data=readCapitalReplayDetail(spec.originProfileId,db,{runId:capitalHash(spec),cellId:null,page:0,limit:1});}finally{db.close();}});
beforeEach(()=>{for(const key of Object.keys(states))Reflect.deleteProperty(states,key);});
const render=(component=CapitalReplayResults,props:object={})=>server.renderToStaticMarkup(react.createElement(component,{client:{},...props}));
describe('P4 truthful recorded result UI',()=>{
 it.each(['loading','failed','blocked','unknown'])('keeps the %s read state explicit',kind=>{states['research.capital-replay.runs']={kind,issues:[{path:[],code:'missing'}]};expect(render()).toContain('Offline replays');});
 it('teaches the empty separate-profile flow without a run or financial command',()=>{states['research.capital-replay.runs']={kind:'ready',value:{runs:[]}};const html=render();expect(html).toContain('separate empty research profile');expect(html).not.toContain('>Run<');expect(html).not.toContain('>Adopt<');});
 it('renders all nine balances and matching controls, with scoped unavailable metrics',()=>{const html=render(ReplayDetail,{data,page:0,onPage:()=>{},onCell:()=>{}});expect(html).toContain('$50.00');expect(html).toContain('$100,000.00');expect(html).toContain('All recorded cells');expect(html).toContain('Unavailable');expect(html).toContain('Active-sleeve TWR');expect(html).toContain('Next evidence page');expect(html).toContain('no research qualification');});
 it('labels model receipts, cost terms and hypotheses independently of account observations',()=>{const html=render(ReplayDetail,{data,page:0,onPage:()=>{},onCell:()=>{}});expect(html).toContain('Simulated net user receipts');expect(html).toContain('execution_notional');expect(html).toContain('capital-flow-performance-v1');expect(html).toContain('no research qualification');expect(html).not.toContain('>Withdraw<');});
 it('preserves archive identity, failures and incomplete evidence instead of showing zero return',()=>{const html=render(ReplayDetail,{data:{...data,run:{...data.run,archived:true,status:'interrupted',reason:'replay_deadline'},cells:[],selected:null},page:0,onPage:()=>{},onCell:()=>{}});expect(html).toContain('Archived origin');expect(html).toContain('replay deadline');expect(html).toContain('not a zero return');});
});
