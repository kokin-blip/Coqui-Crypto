import { createRequire } from 'node:module';import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveUnavailable } from '@coqui/core';import { previewReserve } from '@coqui/services';import { openDatabase, type Db } from '@coqui/storage';
import { NOW, SCOPE } from './helpers/feasibility.js';import { financial, settings } from './helpers/profit-reserve.js';
const channels=vi.hoisted(()=>({} as Record<string,unknown>));
const calls=vi.hoisted(()=>[] as {name:string;enabled:boolean|undefined}[]);
vi.mock('../apps/desktop/src/renderer/query/use-channel.js',()=>({useChannel:(_client:unknown,name:string,_request:unknown,enabled?:boolean)=>{calls.push({name,enabled});return channels[name]??{kind:'loading'};}}));
vi.mock('../apps/desktop/src/renderer/query/use-command.js',()=>({useCommand:()=>({state:{kind:'idle'},value:null,run:vi.fn(),reset:vi.fn()})}));
const desktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url)),react=desktop('react') as {createElement:(component:unknown,props:object)=>unknown},server=desktop('react-dom/server') as {renderToStaticMarkup:(element:unknown)=>string};
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root tests omit JSX support.
const {ProfitReserves,ProfitReserveResult}=await import('../apps/desktop/src/renderer/app/ProfitReserves.js');
let db:Db;beforeEach(()=>{db=openDatabase(':memory:');vi.spyOn(Date,'now').mockReturnValue(NOW);calls.length=0;channels['capital.scopes']={kind:'ready',value:{scopes:[]}};});afterEach(()=>{db.close();vi.restoreAllMocks();});
const render=(component=ProfitReserves,props:object={})=>server.renderToStaticMarkup(react.createElement(component,{client:{},...props}));
const scenario=()=>previewReserve('main',{mode:'scenario',openingUsd:'500',profitUsd:'50',realizedProfitUsd:'50',cashUsd:'550',externalExpenseUsd:'0',settings:settings({retainedCapitalUsd:'500'})},NOW,db);
describe('P3 truthful preview UI and accessibility states',()=>{
  it('offers a separate small-book example without automatically evaluating or enabling account behavior',()=>{const html=render();expect(html).toContain('No verified account');expect(html).toContain('Explore a hypothetical $500 book');expect(html).toContain('Default account behavior remains keep gains invested');expect(html).toContain('0.25%');expect(calls.filter(c=>c.name==='capital.reserve.preview').every(c=>c.enabled===false)).toBe(true);expect(html).not.toContain('>Withdraw<');});
  it.each(['loading','failed','blocked','unknown'])('keeps %s account state explicit',kind=>{channels['capital.scopes']={kind,issues:[{path:[],code:'missing'}]};expect(render()).toContain('Reserve accounts');});
  it('shows observed cash independently of incomplete realized profit, with default disabled settings',()=>{
    channels['capital.scopes']={kind:'ready',value:{scopes:[{scope:{id:SCOPE,environment:'simulation'},mode:'active',label:'Local paper'}]}};
    channels['capital.reserve.view']={kind:'ready',value:{scopeId:SCOPE,policy:null,state:null,archived:false,financial:financial({realizedPnlUsd:reserveUnavailable('missing_basis')}),latest:null}};
    const html=render();expect(html).toContain('Observed account cash');expect(html).toContain('$550.00');expect(html).toContain('Unavailable');expect(html).toContain('Save preview settings');expect(html).toContain('Inspect calculation');expect(html).toContain('value="keep_invested" selected');expect(html).toContain('id=');
  });
  it('expires cash capacity on screen while preserving recorded balances and their dates',()=>{
    channels['capital.scopes']={kind:'ready',value:{scopes:[{scope:{id:SCOPE,environment:'simulation'},mode:'active',label:'Local paper'}]}};
    channels['capital.reserve.view']={kind:'ready',value:{scopeId:SCOPE,policy:null,state:null,archived:false,financial:financial(),latest:null}};
    vi.mocked(Date.now).mockReturnValue(NOW+30_000);const html=render();expect(html).toContain('Unavailable (expired)');expect(html).toContain('$550.00');expect(html).toContain('Budget observed:');
  });
  it('labels modeled cash, fixed base, exact inputs and hypothetical upside/downside without a payout promise',()=>{const html=render(ProfitReserveResult,{inspection:scenario()});expect(html).toContain('Preview consequence: eligible');expect(html).toContain('$12.50');expect(html).toContain('$537.50');expect(html).toContain('No cash was reserved');expect(html).toContain('Fixed assessment base');expect(html).toContain('Exact preview inputs');expect(html).toContain('before personal taxes');expect(html).toContain('no probabilities');});
  it('makes expiry visible without relabeling original observations as current',()=>{const inspection=scenario();vi.mocked(Date.now).mockReturnValue(NOW+30_000);const html=render(ProfitReserveResult,{inspection});expect(html).toContain('Preview consequence: expired');expect(html).toContain('historical evidence');expect(html).toContain('Previously modeled reserve');});
  it('never displays an unknown operating requirement as zero',()=>{const f=scenario(),html=render(ProfitReserveResult,{inspection:{...f,report:{...f.report,operatingRequirement:{...f.report.operatingRequirement,floorUsd:reserveUnavailable('no_operating_proof')}}}});expect(html).toContain('About Retained-capital requirement');expect(html).toContain('Unavailable');});
});
