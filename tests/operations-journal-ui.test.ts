import { createRequire } from 'node:module';
import { describe,expect,it,vi } from 'vitest';

const mocked=vi.hoisted(()=>({journal:{} as Record<string,unknown>}));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js',()=>({useChannel:()=>({kind:'ready',value:{activeProfile:{id:'main'}}})}));
vi.mock('../apps/desktop/src/renderer/app/use-operations-journal.js',()=>({useOperationsJournal:()=>mocked.journal}));
const requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const react=requireDesktop('react') as {createElement:(type:unknown,props:object)=>unknown};
const server=requireDesktop('react-dom/server') as {renderToStaticMarkup:(element:unknown)=>string};
// @ts-expect-error TS6142: the root test compiler intentionally omits JSX support.
const {OperationsJournal}=await import('../apps/desktop/src/renderer/app/OperationsJournal.js');
const group={id:'host:fixture',label:'BTC-USD · paper evaluation',source:'paper_ledger',scope:'profile',
  startedAtMs:100,updatedAtMs:110,status:'blocked'};
function render(patch:Record<string,unknown>={}):string {
  mocked.journal={collapsed:false,paused:false,held:false,worker:null,chosen:group.id,newActivity:false,
    view:{groups:[group],coverage:[],asOfMs:120,nextCursor:null},
    detail:{group,entries:[{id:'fixture-entry',groupId:group.id,attemptId:'attempt',worker:'risk',source:'paper_ledger',
      phase:'gates_finished',status:'blocked',atMs:110,scope:'profile',message:'I blocked this paper plan because the market data is stale.',
      facts:{reasonCode:'stale_market_data',gatesPassed:false},contentHash:'hash'}],historyComplete:true,nextCursor:null,revision:'revision'},
    feed:{kind:'ready',isStale:false},group:{kind:'ready',isStale:false},...patch};
  return server.renderToStaticMarkup(react.createElement(OperationsJournal,{client:{}}));
}
describe('Crew Journal presentation',()=>{
  it('uses the Figma component set and accessible handoff and evidence disclosure',()=>{
    const html=render();
    for(const id of ['3:64','3:66','3:37','3:56','3:46'])expect(html).toContain(`data-figma-node="${id}"`);
    expect(html).toContain('aria-expanded="true"');expect(html).toContain('<summary>Technical details</summary>');
    expect(html).toContain('Guard');expect(html).toContain('stale_market_data');expect(html).toContain('Recorded state');
    expect(html).not.toContain('Inspect decision');
  });
  it('distinguishes waiting, filtering, display pause and collapsed content',()=>{
    expect(render({view:{groups:[],coverage:[],asOfMs:120,nextCursor:null}})).toContain('Waiting for the next recorded update');
    expect(render({worker:'research',view:{groups:[],coverage:[],asOfMs:120,nextCursor:null}})).toContain('No recorded updates for this worker');
    expect(render({paused:true})).toContain('Display paused · work continues');
    const collapsed=render({collapsed:true});expect(collapsed).toContain('Show journal');expect(collapsed).not.toContain('Technical details');
  });
  it('shows bounded history, unknown outcomes and one batched update announcement',()=>{
    const html=render({newActivity:true,view:{groups:[{...group,status:'unknown'}],coverage:[],asOfMs:120,nextCursor:'older'}});
    expect(html).toContain('Current state unconfirmed');expect(html).toContain('aria-live="polite"');
    expect(html).toContain('New activity available');expect(html).toContain('Jump to latest');expect(html).toContain('Load older groups');
  });
});
