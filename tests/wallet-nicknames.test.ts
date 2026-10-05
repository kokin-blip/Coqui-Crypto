import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileWalletNicknameStore, createFileProfileDatabaseDuplicator, setConnectionRemoval, listVerifiedWalletIdentities, openDatabase, saveProfileConnectionV2, saveVerifiedWalletIdentity } from '../packages/storage/src/index.js';
import { profileConnectionV2, sha256Hex } from '../packages/core/src/index.js';
import { createConnectionHandlers } from '../apps/desktop/src/main/connection-handlers.js';

const directories: string[]=[];
afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
function store(){const d=mkdtempSync(join(tmpdir(),'coqui-names-'));directories.push(d);const path=join(d,'wallet-nicknames.json');return {path,store:createFileWalletNicknameStore(path)};}
const key=sha256Hex('identity');
describe('installation-local wallet nicknames',()=>{
  it('adds, edits, clears and survives reopening without secrets',()=>{
    const {path,store:s}=store();expect(s.read()).toEqual({ok:true,value:{revision:null,names:{}}});
    const added=s.set(key,'  Mom’s   Coinbase  ',null);expect(added).toMatchObject({ok:true,value:{names:{[key]:'Mom’s Coinbase'}}});
    if(!added.ok)throw new Error();const edited=s.set(key,'Savings',added.value.revision);if(!edited.ok)throw new Error();
    expect(createFileWalletNicknameStore(path).read()).toMatchObject({ok:true,value:{names:{[key]:'Savings'}}});
    expect(s.set(key,null,edited.value.revision)).toMatchObject({ok:true,value:{names:{}}});
    expect(statSync(path).mode&0o777).toBe(0o600);expect(readFileSync(path,'utf8')).not.toContain('credential');
  });
  it('allows duplicates, rejects invalid input and detects conflicts',()=>{
    const {store:s}=store();const first=s.set(key,'Savings',null);if(!first.ok)throw new Error();
    expect(s.set(sha256Hex('other'),'Savings',first.value.revision)).toMatchObject({ok:true});
    expect(s.set(key,'stale',first.value.revision)).toEqual({ok:false,code:'nickname_store_conflict'});
    for(const name of ['', '  ', 'x'.repeat(81),'a\nb','a\u0000b'])expect(s.set(key,name,null)).toMatchObject({ok:false,code:'invalid_nickname'});
  });
  it('does not overwrite corrupt metadata',()=>{
    const {path,store:s}=store();writeFileSync(path,'invalid');expect(s.read()).toEqual({ok:false,code:'nickname_store_corrupt'});
    expect(s.set(key,'Savings',null)).toEqual({ok:false,code:'nickname_store_corrupt'});expect(readFileSync(path,'utf8')).toBe('invalid');
  });
  it('follows verified identity across profiles and API-key rotation without sharing wallet handles',async()=>{
    const db=openDatabase(':memory:');const {store:s}=store();
    const connections=[profileConnectionV2('main','coinbase',sha256Hex('key1'),10),profileConnectionV2('other','coinbase',sha256Hex('key2'),10),profileConnectionV2('main','coinbase',sha256Hex('key3'),10)];
    for(const c of connections){saveProfileConnectionV2(c,db);saveVerifiedWalletIdentity(c,'portfolio','11111111-2222-4333-8444-555555551234',10,db);}
    const main=listVerifiedWalletIdentities('main',db);const other=listVerifiedWalletIdentities('other',db);
    expect(main[0]!.canonical_key).toBe(other[0]!.canonical_key);expect(main[0]!.id).not.toBe(other[0]!.id);
    s.set(main[0]!.canonical_key,'Savings',null);
    const handlers=createConnectionHandlers({profileId:'other',database:db,clock:{nowMs:()=>20},nicknameStore:s,priceSource:{name:'fixture',async spot(){return new Map();}}});
    const list=await handlers['wallets.list']!({} as never);expect(list).toMatchObject({ok:true,value:{profileId:'other',wallets:[{nickname:'Savings',connectionId:connections[1]!.id}]}});
    expect(await handlers['wallets.nickname.set']!({commandId:'foreign',walletId:main[0]!.id,nickname:'Wrong',revision:null} as never)).toMatchObject({ok:false,issues:[{code:'wallet_not_found'}]});
    const dump=JSON.stringify(db.prepare('SELECT * FROM connection_wallet_identities_v1').all());expect(dump).not.toContain('Savings');expect(dump).not.toContain('11111111-2222-4333-8444-555555551234');db.close();
  });
  it('keeps distinct provider accounts independent and rejects a changed Coinbase portfolio',()=>{
    const db=openDatabase(':memory:');const c=profileConnectionV2('main','robinhood_crypto',sha256Hex('key'),10);saveProfileConnectionV2(c,db);
    saveVerifiedWalletIdentity(c,'account','account-1234',10,db);saveVerifiedWalletIdentity(c,'account','account-5678',10,db);
    expect(new Set(listVerifiedWalletIdentities('main',db).map(w=>w.canonical_key)).size).toBe(2);
    const cb=profileConnectionV2('main','coinbase',sha256Hex('cb'),10);saveProfileConnectionV2(cb,db);saveVerifiedWalletIdentity(cb,'portfolio','portfolio1',10,db);
    expect(()=>saveVerifiedWalletIdentity(cb,'portfolio','portfolio2',10,db)).toThrow('identity changed');db.close();
  });
});

it('duplication strips new connector metadata while keeping installation nicknames',async()=>{
  const {path,store:s}=store();const root=path.slice(0,path.lastIndexOf('/'));const db=openDatabase(join(root,'source.db'));
  const c=profileConnectionV2('main','coinbase',sha256Hex('key'),10);saveProfileConnectionV2(c,db);saveVerifiedWalletIdentity(c,'portfolio','11111111-2222-4333-8444-555555551234',10,db);setConnectionRemoval(c,'removed','removed',20,db);
  s.set(listVerifiedWalletIdentities('main',db)[0]!.canonical_key,'Persistent local name',null);db.close();
  const target='00000000-0000-4000-8000-000000000001';
  expect(await createFileProfileDatabaseDuplicator(root).duplicate({sourceProfileId:'main',sourceDbFilename:'source.db',targetProfileId:target,targetDbFilename:`wallet-${target}.db`})).toMatchObject({ok:true});
  const copy=openDatabase(join(root,`wallet-${target}.db`));for(const table of ['connection_removals_v1','connection_wallet_identities_v1','profile_connections_v2'])expect(copy.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({count:0});copy.close();expect(s.read()).toMatchObject({ok:true,value:{names:expect.objectContaining({[sha256Hex(`local-wallet-v1:coinbase:portfolio:${sha256Hex('11111111-2222-4333-8444-555555551234')}`)]:'Persistent local name'})}});
});
