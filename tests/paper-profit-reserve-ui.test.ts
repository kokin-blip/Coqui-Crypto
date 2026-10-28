import { createRequire } from 'node:module';import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';import { settings } from './helpers/profit-reserve.js';
const channels=vi.hoisted(()=>({} as Record<string,unknown>));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js',()=>({useChannel:(_c:unknown,name:string)=>channels[name]??{kind:'loading'}}));
vi.mock('../apps/desktop/src/renderer/query/use-command.js',()=>({useCommand:()=>({state:{kind:'idle'},run:vi.fn(),value:null,reset:vi.fn()})}));
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url)),React=require('react') as {createElement:(component:unknown,props:object,...children:unknown[])=>unknown},server=require('react-dom/server') as {renderToStaticMarkup:(v:unknown)=>string};
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root test config excludes JSX.
const {PaperProfitReserves}=await import('../apps/desktop/src/renderer/app/PaperProfitReserves.js');
vi.mock('../apps/desktop/src/renderer/app/PaperReserveSale.js',()=>({PaperReserveSale:()=>null}));
const render=()=>server.renderToStaticMarkup(React.createElement(PaperProfitReserves,{client:{}}));
beforeEach(()=>{for(const key of Object.keys(channels))Reflect.deleteProperty(channels,key);});afterEach(()=>vi.restoreAllMocks());
describe('P6 truthful default-off controls',()=>{
  it('offers an explicit $500 simulated opening without enrolling or arming existing books',()=>{channels['paper.reserve.books']={kind:'ready',value:[]};const html=render();expect(html).toContain('value="500"');expect(html).toContain('grants no trading or reserve authority');expect(html).toContain('Create simulated cash book');expect(html).not.toContain('Confirm internal paper reserve');});
  it('separates policy authorization, review, release, and manual Resume with unavailable evidence explicit',()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});const v=f.service.view();channels['paper.reserve.books']={kind:'ready',value:[{book:v.book,archived:false,disabled:true}]};channels['paper.reserve.view']={kind:'ready',value:v};channels['paper.reserve.preview']={kind:'ready',value:f.service.preview()};
    const html=render();expect(html).toContain('saving disarms');expect(html).toContain('manually Resume');expect(html).toContain('Confirm reviewed release; keep H');expect(html).toContain('never commits funds');expect(html).toContain('No external withdrawal');expect(html).toContain('id=');expect(html).toContain('disabled');
  }finally{f.db.close();}});
  it('copied archived evidence offers no operational action',()=>{channels['paper.reserve.books']={kind:'ready',value:[{book:{},archived:true,disabled:true}]};const html=render();expect(html).toContain('Archived copied evidence');expect(html).not.toContain('Review and authorize policy');});
  it('explains missing trade-plan evidence with readable caps and recovery',()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});const v=f.service.view();channels['paper.reserve.books']={kind:'ready',value:[{book:v.book,archived:false,disabled:true}]};channels['paper.reserve.view']={kind:'ready',value:v};channels['paper.reserve.preview']={kind:'ready',value:{...f.service.preview(),reasonCodes:['fixed_strategy_request_missing_or_unnetted','operating_requirement_binding_missing']}};
    const html=render();expect(html).toContain('Available realized profit cap');expect(html).toContain('Check the allocation and completed market history');expect(html).toContain('review a new consequence');expect(html).not.toContain('capitalUsd cap');
  }finally{f.db.close();}});
});
