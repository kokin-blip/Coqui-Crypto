import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {capitalHash} from '@coqui/core';
import {openDatabase,createFileProfileManifestStore,appendIntegrityEvent} from '@coqui/storage';
import {loadCapitalReplayTape,offlineReplayContext,assertReplayDevelopmentBoundary,runCapitalReplay} from '@coqui/services';
import {replayFixture,REPLAY_START as T,REPLAY_DAY as DAY,REPLAY_ASSET as A} from './helpers/capital-replay.js';
describe('P4 physical development and lifecycle boundaries',()=>{
 it('reads only an explicit hash-bound separate development tape',async()=>{
  const root=mkdtempSync(join(tmpdir(),'coqui-p4-data-'));try{const {spec,tape}=replayFixture(),payload=JSON.stringify(tape);writeFileSync(join(root,'tape.json'),payload);
   const m={version:1,exposure:spec.exposure,provider:spec.provider,fromMs:spec.fromMs,toMs:spec.toMs,warmupFromMs:spec.warmupFromMs,kind:'json_tape',file:{path:'tape.json',sha256:createHash('sha256').update(payload).digest('hex'),bytes:Buffer.byteLength(payload)},archives:[]};
   writeFileSync(join(root,'input.json'),JSON.stringify(m));expect(await loadCapitalReplayTape({...spec,sourceRefs:[capitalHash(m)]},join(root,'input.json'))).toEqual(tape);
   writeFileSync(join(root,'tape.json'),'{}');await expect(loadCapitalReplayTape({...spec,sourceRefs:[capitalHash(m)]},join(root,'input.json'))).rejects.toThrow('file_bound');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('refuses a physically mixed final archive before query/verification or tape-body access',async()=>{
  const root=mkdtempSync(join(tmpdir(),'coqui-p4-sealed-'));try{const {spec}=replayFixture();mkdirSync(join(root,'archive'));writeFileSync(join(root,'archive','manifest.json'),JSON.stringify({firstStartTimeMs:spec.fromMs,lastStartTimeMs:spec.toMs,files:[{venue:'coinbase',interval:'1d'}]}));
   const m={version:1,exposure:spec.exposure,provider:spec.provider,fromMs:spec.fromMs,toMs:spec.toMs,warmupFromMs:spec.warmupFromMs,kind:'archive_market',file:{path:'sealed-body-must-not-open',sha256:'a'.repeat(64),bytes:20},archives:['archive']};writeFileSync(join(root,'input.json'),JSON.stringify(m));
   const query=vi.fn();await expect(loadCapitalReplayTape({...spec,sourceRefs:[capitalHash(m)]},join(root,'input.json'),query)).rejects.toThrow('outside_development');expect(query).not.toHaveBeenCalled();
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('binds CLI access to the original inactive profile and detects lifecycle changes',()=>{
  const root=mkdtempSync(join(tmpdir(),'coqui-p4-profile-'));try{const id=randomUUID(),filename=`wallet-${id}.db`,db=openDatabase(join(root,filename));db.close();const manifest=join(root,'profiles.json'),store=createFileProfileManifestStore(manifest);
   const profiles=[{id:'main',name:'Main',color:'#60a5fa' as const,icon:'wallet' as const,dbFilename:'coqui.db',createdAt:1,lastOpenedAt:1,order:0},{id,name:'Research',color:'#60a5fa' as const,icon:'wallet' as const,dbFilename:filename,createdAt:1,lastOpenedAt:1,order:1}];
   expect(store.replace(null,{version:1,activeProfileId:'main',profiles}).ok).toBe(true);const context=offlineReplayContext(manifest,id,join(root,filename),'work');expect(()=>context.assertCurrent()).not.toThrow();
   const before=store.read();if(!before.ok||!before.value)throw new Error('fixture');store.replace(before.value.revision,{...before.value.manifest,activeProfileId:id});expect(()=>context.assertCurrent()).toThrow('lifecycle');expect(()=>offlineReplayContext(manifest,id,join(root,filename),'work')).toThrow('inactive');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('rejects consumed overlap and absent development metadata without loading final bodies',()=>{
  const {spec}=replayFixture(),db=openDatabase(':memory:');try{const s={...spec,exposure:'exposed_development' as const};expect(()=>assertReplayDevelopmentBoundary(s,db)).toThrow('metadata_missing');
   appendIntegrityEvent({namespace:'audit',kind:'final_claim',key:'once',atMs:T,body:{startMs:T,endExclusiveMs:T+10*DAY,assets:[A]}},db);
   db.prepare('INSERT INTO research_integrity_events(namespace,kind,record_key,at_ms,body_json,content_hash) VALUES(?,?,?,?,?,?)').run('audit','final_result','sealed',T,'{"do_not_read":true}','0'.repeat(64));
   expect(()=>assertReplayDevelopmentBoundary(s,db)).toThrow('consumed');
  }finally{db.close();}
 });
 it('rejects exposed data before the loader, and preserves an auditable failed attempt',async()=>{
  const {spec}=replayFixture(),db=openDatabase(':memory:'),loader=vi.fn();try{await expect(runCapitalReplay({spec:{...spec,exposure:'exposed_development'},loadTape:loader,context:{profileId:spec.originProfileId,workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>1,retry:false},db)).rejects.toThrow();expect(loader).not.toHaveBeenCalled();expect(Number(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE kind='capital_replay_failure'").get()?.['n'])).toBe(1);
  }finally{db.close();}
 });
});
