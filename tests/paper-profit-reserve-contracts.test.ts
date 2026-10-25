import { describe,it,expect } from 'vitest';
import { CHANNEL_SCHEMAS,isWriteChannel } from '@coqui/contracts';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { createPaperReserveHandlers } from '../apps/desktop/src/main/paper-reserve-handlers.js';
import { createProfileOperationGate } from '@coqui/services';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';
import { settings } from './helpers/profit-reserve.js';
describe('P6 strict read/write boundary',()=>{
  it('refuses renderer financial facts, fake permission flags, connected environments and non UUID commands',()=>{
    const f=reserveServiceFixture();try{const r=f.request();
      for(const extra of [{verified:true},{environment:'paper'},{financial:{profit:'100'}},{witness:{floor:'0'}},{amountUsd:'100'}])expect(CHANNEL_SCHEMAS['paper.reserve.authorize'].request.safeParse({...r,...extra}).success).toBe(false);
      expect(CHANNEL_SCHEMAS['paper.reserve.authorize'].request.safeParse({...r,commandId:'retry-anything'}).success).toBe(false);
      expect(isWriteChannel('paper.reserve.preview')).toBe(false);expect(isWriteChannel('paper.reserve.observe')).toBe(true);
    }finally{f.db.close();}
  });
  it('new reads make no database writes; the profile gate excludes competing commands',async()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});const gate=createProfileOperationGate(),dispatch=createDispatcher({handlers:()=>createPaperReserveHandlers('main',f.db,f.now,f.service,gate)});
    const before=f.db.prepare('SELECT total_changes() n').get()!['n'];
    for(const name of ['paper.reserve.books','paper.reserve.view','paper.reserve.preview','paper.reserve.operations'] as const)expect((await dispatch(name,{})).status).toBe('ok');
    expect(f.db.prepare('SELECT total_changes() n').get()!['n']).toBe(before);
    gate.begin();expect((await dispatch('paper.reserve.authorize',f.request())).status).not.toBe('ok');gate.end();expect(f.authority.armed).toBe(false);
  }finally{f.db.close();}});
});
