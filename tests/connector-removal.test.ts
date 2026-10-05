import { describe, expect, it, vi } from 'vitest';
import { createMemorySecretStore, readConnectionSecret, writeConnectionSecret } from '../packages/adapters/src/index.js';
import { FixedClock, profileConnectionV2, sha256Hex } from '../packages/core/src/index.js';
import { ConnectorRemovalService, connectorRemovalPreview, persistCoinbasePortfolioSnapshotV2 } from '../packages/services/src/index.js';
import { connectionRemoval, getCurrentUnifiedPortfolioSnapshotV2, getLatestUnifiedPortfolioSnapshotV2, listPortfolioValuationObservations, openDatabase, saveProfileConnectionV2 } from '../packages/storage/src/index.js';
import { createConnectionHandlers } from '../apps/desktop/src/main/connection-handlers.js';

const priceSource={name:'fixture',async spot(){return new Map();}};
async function fixture(path = ':memory:'){
  const db=openDatabase(path);const secrets=createMemorySecretStore();const clock=new FixedClock(100);
  const a=profileConnectionV2('main','coinbase',sha256Hex('key-a'),10),b=profileConnectionV2('main','coinbase',sha256Hex('key-b'),10);
  for(const c of [a,b]){
    saveProfileConnectionV2(c,db);await writeConnectionSecret(secrets,{profileId:'main',connectionId:c.id,provider:'coinbase',credentialType:'api_credentials'},'fixture-only');
    await persistCoinbasePortfolioSnapshotV2({profileId:'main',credentialFingerprint:c.credentialFingerprint,requestedAtMs:10,receivedAtMs:20,
      accounts:[{accountUuid:c.id,currency:'USD',availableQuantity:'50' as never,holdQuantity:'0' as never,totalQuantity:'50' as never,active:true,ready:true,defaultAccount:true,providerUpdatedAtMs:10}]},db,priceSource);
  }
  const service=new ConnectorRemovalService({profileId:'main',database:db,clock,secrets});return {db,secrets,clock,a,b,service};
}
describe('connector retirement',()=>{
  it('removes credentials/current balances, hides Settings row, and preserves immutable history',async()=>{
    const {db,secrets,clock,a,b,service}=await fixture();const before=getLatestUnifiedPortfolioSnapshotV2('main',false,db)!;const observations=listPortfolioValuationObservations('main',db);
    const preview=connectorRemovalPreview('main',a.id,100,db)!;
    expect(await service.remove(a.id,'remove-a',preview.revision,true)).toMatchObject({ok:true,value:{outcome:'removed',historyPreserved:true}});
    expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)).toMatchObject({totalValueUsd:'50',exposures:[{contributions:[{connectionId:b.id}]}]});
    expect(db.prepare('SELECT id FROM unified_portfolio_snapshots_v2 WHERE id=?').get(before.id)).toEqual({id:before.id});
    expect(listPortfolioValuationObservations('main',db)).toEqual(observations);
    expect(await readConnectionSecret(secrets,{profileId:'main',connectionId:a.id,provider:'coinbase',credentialType:'api_credentials'})).toEqual({ok:true,value:null});
    const handlers=createConnectionHandlers({profileId:'main',database:db,clock,secrets,priceSource});
    expect(await handlers['connections.list']!({} as never)).toMatchObject({ok:true,value:{connections:[{id:b.id}]}});
    expect(await service.remove(a.id,'retry',preview.revision,true)).toMatchObject({ok:true});
    const second=connectorRemovalPreview('main',b.id,100,db)!;await service.remove(b.id,'remove-b',second.revision,true);expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)).toBeNull();db.close();
  });
  it('requires confirmation, refuses stale previews, foreign profiles and active execution',async()=>{
    const {db,a,service}=await fixture();const preview=connectorRemovalPreview('main',a.id,100,db)!;
    expect(await service.remove(a.id,'no',preview.revision,false)).toMatchObject({ok:false,issues:[{code:'confirmation_required'}]});
    saveProfileConnectionV2({...a,label:'Changed',updatedAtMs:30},db);
    expect(await service.remove(a.id,'stale',preview.revision,true)).toMatchObject({ok:false,issues:[{code:'removal_preview_stale'}]});
    db.prepare('INSERT INTO execution_leases_v1 VALUES(?,?,?,?,?)').run('main','owner',200,1,100);
    expect(connectorRemovalPreview('main',a.id,100,db)!.blockers).toContain('execution_in_progress');
    expect(await service.remove(a.id,'busy',preview.revision,true)).toMatchObject({ok:false,issues:[{code:'connection_in_use'}]});
    const foreign=new ConnectorRemovalService({profileId:'other',database:db,clock:new FixedClock(100)});
    expect(await foreign.remove(a.id,'foreign',preview.revision,true)).toMatchObject({ok:false,issues:[{code:'connection_not_found'}]});db.close();
  });
  it('fails closed and resumes confirmed cleanup after a secret-store failure/restart',async()=>{
    const {db,secrets,clock,a,service}=await fixture();const preview=connectorRemovalPreview('main',a.id,100,db)!;
    const remove=vi.spyOn(secrets,'remove').mockResolvedValueOnce({ok:false,code:'unavailable',message:'unavailable'});
    expect(await service.remove(a.id,'interrupted',preview.revision,true)).toMatchObject({ok:false,issues:[{code:'removal_recovery_required'}]});
    expect(connectionRemoval('main',a.id,db)?.state).toBe('pending');expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)?.totalValueUsd).toBe('50');remove.mockRestore();
    const restarted=new ConnectorRemovalService({profileId:'main',database:db,clock,secrets});
    expect(await restarted.remove(a.id,'resume',connectorRemovalPreview('main',a.id,100,db)!.revision,true)).toMatchObject({ok:true});db.close();
  });
  it('supports disconnected/failed-first-sync connectors without synthesizing balances',async()=>{
    const db=openDatabase(':memory:');const c={...profileConnectionV2('main','coinbase',sha256Hex('bad'),10),status:'disconnected' as const};saveProfileConnectionV2(c,db);
    const service=new ConnectorRemovalService({profileId:'main',database:db,clock:new FixedClock(20),secrets:createMemorySecretStore()});const preview=connectorRemovalPreview('main',c.id,20,db)!;
    expect(preview).toMatchObject({retainedSnapshots:0,affectedBalances:[],eligible:true});expect(await service.remove(c.id,'remove',preview.revision,true)).toMatchObject({ok:true});expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)).toBeNull();db.close();
  });
  it('includes missing remaining sources as incomplete instead of asserting a complete subtotal',async()=>{
    const {db}=await fixture();const c=profileConnectionV2('main','coinbase',sha256Hex('no-snapshot'),10);saveProfileConnectionV2(c,db);
    expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)).toMatchObject({complete:false,totalValueUsd:null,exposures:[{quantity:'100'}]});db.close();
  });
});

describe('lifecycle serialization and compatibility',()=>{
  it('serializes cleanup with sync and profile switching, then allows a new command to recover',async()=>{
    const {db,secrets,clock,a}=await fixture();
    const {createProfileOperationGate}=await import('../packages/services/src/accounts/profiles.js');const gate=createProfileOperationGate();
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const original=secrets.remove.bind(secrets);vi.spyOn(secrets,'remove').mockImplementationOnce(async(...args)=>{await wait;return original(...args);});
    const handlers=createConnectionHandlers({profileId:'main',database:db,clock,secrets,priceSource,operationGate:gate});
    const preview=connectorRemovalPreview('main',a.id,100,db)!;
    const pending=handlers['connections.remove']!({commandId:'serialized',connectionId:a.id,revision:preview.revision,confirmed:true} as never);
    expect(gate.isBusy()).toBe(true);expect(gate.begin()).toBe(false);
    expect(await handlers['connections.sync']!({commandId:'sync-during-removal',connectionId:a.id} as never)).toMatchObject({ok:false,issues:[{code:'connection_operation_in_progress'}]});
    const repeated=handlers['connections.remove']!({commandId:'serialized',connectionId:a.id,revision:preview.revision,confirmed:true} as never);
    release();expect(await pending).toMatchObject({ok:true});expect(await repeated).toMatchObject({ok:true});expect(gate.isBusy()).toBe(false);db.close();
  });
  it('applies balance exclusion to compatibility disconnect and never resurrects legacy rows',async()=>{
    const {db,secrets,clock,a}=await fixture();

    const handlers=createConnectionHandlers({profileId:'main',database:db,clock,secrets,priceSource});
    expect(await handlers['connections.disconnect']!({commandId:'disconnect',connectionId:a.id} as never)).toMatchObject({ok:true,value:{status:'disconnected'}});
    expect(getCurrentUnifiedPortfolioSnapshotV2('main',db)?.totalValueUsd).toBe('50');
    await handlers['connections.list']!({} as never);
    expect(await handlers['connections.sync']!({commandId:'sync-disconnected',connectionId:a.id} as never)).toMatchObject({ok:false,issues:[{code:'connection_disconnected'}]});
    const service=new ConnectorRemovalService({profileId:'main',database:db,clock,secrets});
    await service.remove(a.id,'retire',connectorRemovalPreview('main',a.id,100,db)!.revision,true);
    expect(await handlers['connections.list']!({} as never)).toMatchObject({ok:true,value:{connections:expect.not.arrayContaining([expect.objectContaining({id:a.id})])}});db.close();
  });
  it('records recovery if an external secret operation throws',async()=>{
    const {db,secrets,clock,a}=await fixture();vi.spyOn(secrets,'remove').mockRejectedValueOnce(new Error('OS keychain unavailable'));
    const service=new ConnectorRemovalService({profileId:'main',database:db,clock,secrets});
    expect(await service.remove(a.id,'throw',connectorRemovalPreview('main',a.id,100,db)!.revision,true)).toMatchObject({ok:false,issues:[{code:'removal_recovery_required'}]});expect(connectionRemoval('main',a.id,db)?.state).toBe('pending');db.close();
  });
});

it('binds new disconnect confirmations to the displayed preview while retaining legacy compatibility',async()=>{
  const {db,secrets,clock,a}=await fixture();const handlers=createConnectionHandlers({profileId:'main',database:db,clock,secrets,priceSource});const preview=connectorRemovalPreview('main',a.id,100,db)!;
  saveProfileConnectionV2({...a,label:'Changed after preview',updatedAtMs:50},db);
  expect(await handlers['connections.disconnect']!({commandId:'stale-disconnect',connectionId:a.id,revision:preview.revision,confirmed:true} as never)).toMatchObject({ok:false,issues:[{code:'removal_preview_stale'}]});expect(connectionRemoval('main',a.id,db)).toBeNull();db.close();
});

it('cleans only matching legacy aliases and manifest fingerprints',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {createFileProfileManifestStore,getLegacyProfileConnectionId}=await import('../packages/storage/src/index.js');const root=mkdtempSync(join(tmpdir(),'coqui-removal-manifest-'));
  const {db,secrets,clock,a,b}=await fixture();try{
    const manifestStore=createFileProfileManifestStore(join(root,'profiles.json'));
    expect(manifestStore.replace(null,{version:1,activeProfileId:'main',profiles:[{id:'main',name:'Main',color:'#34d399',icon:'wallet',dbFilename:'coqui.db',createdAt:1,lastOpenedAt:1,order:0,coinbaseKeyFingerprint:b.credentialFingerprint,coinbasePortfolioFingerprint:sha256Hex('verified-portfolio')}]}).ok).toBe(true);
    await secrets.write('coinbase-credentials',JSON.stringify({keyName:'key-b',privateKey:'fixture-only'}),'main');
    const alias=getLegacyProfileConnectionId('main',a.id,db)!;await writeConnectionSecret(secrets,{profileId:'main',connectionId:alias,provider:'coinbase',credentialType:'api_credentials'},'legacy-fixture');
    const removal=new ConnectorRemovalService({profileId:'main',database:db,clock,secrets,manifestStore});
    expect(await removal.remove(a.id,'remove-unrelated',connectorRemovalPreview('main',a.id,100,db)!.revision,true)).toMatchObject({ok:true});
    expect(await readConnectionSecret(secrets,{profileId:'main',connectionId:alias,provider:'coinbase',credentialType:'api_credentials'})).toEqual({ok:true,value:null});
    expect(await secrets.read('coinbase-credentials','main')).toMatchObject({ok:true,value:expect.stringContaining('key-b')});
    const retained=manifestStore.read();if(!retained.ok)throw new Error();expect(retained.value!.manifest.profiles[0]!.coinbaseKeyFingerprint).toBe(b.credentialFingerprint);
    expect(await removal.remove(b.id,'remove-matching',connectorRemovalPreview('main',b.id,100,db)!.revision,true)).toMatchObject({ok:true});
    const cleared=manifestStore.read();if(!cleared.ok)throw new Error();expect(cleared.value!.manifest.profiles[0]).not.toHaveProperty('coinbaseKeyFingerprint');expect(cleared.value!.manifest.profiles[0]).not.toHaveProperty('coinbasePortfolioFingerprint');expect(await secrets.read('coinbase-credentials','main')).toEqual({ok:true,value:null});
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

it('persists interrupted cleanup across closing and reopening the profile database',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const root=mkdtempSync(join(tmpdir(),'coqui-removal-restart-'));const path=join(root,'coqui.db');
  const {db,secrets,clock,a,service}=await fixture(path);const fail=vi.spyOn(secrets,'remove').mockResolvedValueOnce({ok:false,code:'unavailable',message:'fixture failure'});
  expect(await service.remove(a.id,'restart-failure',connectorRemovalPreview('main',a.id,100,db)!.revision,true)).toMatchObject({ok:false});fail.mockRestore();db.close();
  const reopened=openDatabase(path);try{expect(connectionRemoval('main',a.id,reopened)?.state).toBe('pending');expect(getCurrentUnifiedPortfolioSnapshotV2('main',reopened)?.totalValueUsd).toBe('50');
    const recovery=new ConnectorRemovalService({profileId:'main',database:reopened,clock,secrets});expect(await recovery.remove(a.id,'restart-recovery',connectorRemovalPreview('main',a.id,100,reopened)!.revision,true)).toMatchObject({ok:true});
  }finally{reopened.close();rmSync(root,{recursive:true,force:true});}
});
