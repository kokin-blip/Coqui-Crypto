import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strategyDecisionId, sha256Hex, instrumentKey, projectPaperPosition, markPaperPosition, samePaperQuantity, type ActivityFill } from '../packages/core/src/index.js';
import { openDatabase, bootstrapPaperBalances, readTradingActivity, tradingActivityScopes, savePaperExecutionProposal, readDetachedProfileDecision, tradingActivityRevision, saveStrategyDecision } from '../packages/storage/src/index.js';
import { createTradingActivityHandlers } from '../apps/desktop/src/main/trading-activity-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const fill=(id:string,side:'buy'|'sell',quantity:string,price:string,feeUsd:string|null,atMs:number):ActivityFill=>({id,productId:'BTC-USD',side,quantity,price,feeUsd,atMs});
describe('paper position accounting',()=>{
  it('separates partial realized profit and remaining fee-inclusive unrealized profit',()=>{
    const p=projectPaperPosition({openingQuantity:'0',markUsd:'120',fills:[fill('b','buy','2','100','2',1),fill('s','sell','1','120','1',2)]});
    expect(p).toMatchObject({quantity:'1',averageEntryUsd:'100',entryAtMs:1,knownBasisUsd:'101',realizedPnlUsd:'18',unrealizedPnlUsd:'19',status:'holding'});
    expect(p.exits[0]).toMatchObject({price:'120',quantity:'1',feeUsd:'1',realizedPnlUsd:'18'});
  });
  it('uses FIFO across purchases, preserves decimals, and deduplicates recorded fills',()=>{
    const b=fill('b','buy','0.0000000000000001','100','0',1);
    const p=projectPaperPosition({openingQuantity:'0',markUsd:'130',fills:[fill('c','buy','1','120','0',2),b,b]});
    expect(p.quantity).toBe('1.0000000000000001');expect(samePaperQuantity(p.quantity,'1')).toBe(false);
    const closed=projectPaperPosition({openingQuantity:'0',markUsd:'130',fills:[fill('b','buy','1','100','1',1),fill('c','buy','1','110','1',2),fill('s','sell','1.5','120','1.5',3)]});
    expect(closed.realizedPnlUsd).toBe('22');expect(closed.knownBasisUsd).toBe('55.5');
  });
  it('consumes imported inventory before later buys without inventing a purchase basis',()=>{
    const p=projectPaperPosition({openingQuantity:'2',markUsd:'120',fills:[fill('b','buy','1','100','1',1),fill('s','sell','1','120','1',2)]});
    expect(p).toMatchObject({quantity:'2',entryAtMs:null,averageEntryUsd:null,basisComplete:false,realizedPnlUsd:null,knownRealizedPnlUsd:'0',unrealizedPnlUsd:null,knownUnrealizedPnlUsd:'19'});
  });
  it('keeps missing fees and missing marks unknown, and closes positions without open profit',()=>{
    const unknown=projectPaperPosition({openingQuantity:'0',markUsd:'120',fills:[fill('b','buy','1','100',null,1)]});
    expect(unknown.averageEntryUsd).toBe('100');expect(unknown.unrealizedPnlUsd).toBeNull();
    expect(markPaperPosition(unknown,null).knownUnrealizedPnlUsd).toBeNull();
    const closed=projectPaperPosition({openingQuantity:'0',markUsd:'120',fills:[fill('b','buy','1','100','1',1),fill('s','sell','1','120','1',2)]});
    expect(closed).toMatchObject({status:'closed',quantity:'0',realizedPnlUsd:'18',unrealizedPnlUsd:'0',entryAtMs:null});
  });
});
describe('read-only activity boundary',()=>{
  it('exposes opening holdings as unknown basis and validates the summary wire shape',async()=>{
    const db=openDatabase(':memory:');
    try {
      bootstrapPaperBalances('main',[{assetId:'USD',quantity:'1000'},{assetId:instrumentKey({venue:'coinbase',productType:'spot',productId:'BTC-USD'}),quantity:'1'}],'opening',1,db);
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>10000,mark:()=>({priceUsd:'120',source:'test quote',atMs:9900})})});
      const result=await dispatch('trading.activity.summary',{scopeId:'ledger',connectionId:null,productId:'BTC-USD'});
      expect(result.status).toBe('ok');if(result.status!=='ok')throw new Error(JSON.stringify(result));
      expect((result.value as {positions:Array<{quantity:string;basisComplete:boolean;entryAtMs:number|null}>}).positions[0]).toMatchObject({quantity:'1',basisComplete:false,entryAtMs:null});
      expect(await dispatch('trading.activity.summary',{scopeId:'exploratory:other',connectionId:null,productId:'BTC-USD'})).toMatchObject({status:'failed'});
    }finally{db.close();}
  });
  it('distinguishes proposals from fills and rejects another wallet selection',async()=>{
    const db=openDatabase(':memory:');try{
      savePaperExecutionProposal({id:'proposal',profileId:'main',runId:'run',revision:1,proposalHash:'a'.repeat(64),intentsJson:JSON.stringify([{asset:{instrument:{productId:'BTC-USD'}},side:'buy',amountUsd:'100'}]),status:'unknown',createdAt:1,updatedAt:2},db);
      const scope=tradingActivityScopes('main',db).scopes[0]!;
      const facts=readTradingActivity('main',scope,null,'BTC-USD',db);
      expect(facts.entries.map(e=>[e.kind,e.status])).toEqual([['proposal','proposed'],['proposal','unknown']]);expect(facts.fills).toEqual([]);
      expect(readTradingActivity('other', {...scope,profileId:'other'},null,'BTC-USD',db).entries).toEqual([]);
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>3,mark:()=>null})});
      expect(await dispatch('trading.activity.summary',{scopeId:'ledger',connectionId:'not-owned',productId:'BTC-USD'})).toMatchObject({status:'failed'});
      const trail=await dispatch('trading.activity.trail',{scopeId:'ledger',connectionId:null,productId:'BTC-USD',limit:1,cursor:null});expect(trail.status).toBe('ok');
      if(trail.status==='ok'){const page=trail.value as {items:Array<{status:string}>;nextCursor:string};expect(page.items[0]?.status).toBe('unknown');expect(page.nextCursor).not.toBeNull();expect(await dispatch('trading.activity.trail',{scopeId:'ledger',connectionId:null,productId:'BTC-USD',limit:1,cursor:page.nextCursor})).toMatchObject({status:'ok',value:{items:[{status:'proposed'}]}});}
      const before=tradingActivityRevision('main',db);expect(tradingActivityRevision('main',db)).toBe(before);
      savePaperExecutionProposal({id:'second',profileId:'main',runId:'second-run',revision:1,proposalHash:'b'.repeat(64),intentsJson:JSON.stringify([{asset:{instrument:{productId:'BTC-USD'}},side:'buy',amountUsd:'10'}]),status:'pending_review',createdAt:1,updatedAt:2},db);
      expect(tradingActivityRevision('main',db)).not.toBe(before);
      expect(await dispatch('trading.activity.trail',{scopeId:'ledger',connectionId:null,productId:'BTC-USD',limit:30,cursor:null})).toMatchObject({status:'ok',value:{items:expect.arrayContaining([expect.objectContaining({proposalId:'second'})])}});

    }finally{db.close();}
  });
  it('reads other profiles as detached context without migrations or path escape',()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-shared-test-'));dirs.push(dir);const db=openDatabase(join(dir,'wallet.db'));const version=db.prepare('PRAGMA user_version').get();
    const profile='00000000-0000-4000-8000-000000000001';
    saveStrategyDecision({schemaVersion:1,decisionId:strategyDecisionId(profile,1),profileId:profile,runId:sha256Hex('shared-run'),scheduledForMs:1,strategy:{id:'trendvol',version:'v1',configHash:sha256Hex('config')},market:{snapshotHash:sha256Hex('market'),asOfMs:0,expectedAsOfMs:0,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:sha256Hex('rules'),rulesFresh:true},portfolio:{snapshotHash:sha256Hex('portfolio'),version:'paper-v1',source:'paper_ledger'},targets:[{assetId:'coinbase|spot|BTC-USD',weight:.25}],cashWeight:.75,exposure:.25,historyStatus:'complete',facts:null,createdAtMs:1},db);
    db.close();
    expect(readDetachedProfileDecision(dir,profile,'wallet.db','BTC')?.decision).toMatchObject({profileId:profile,createdAtMs:1,targets:[{weight:.25}]});
    expect(readDetachedProfileDecision(dir,profile,'wallet.db','ETH')).toBeNull();
    expect(readDetachedProfileDecision(dir,'main','wallet.db','BTC')).toBeNull();
    expect(()=>readDetachedProfileDecision(dir,'main','../wallet.db','BTC')).toThrow();
    expect(()=>readDetachedProfileDecision(dir,'main','wallet.db','BTC;DROP')).toThrow();
    const check=openDatabase(join(dir,'wallet.db'),{skipMigrations:true});expect(check.prepare('PRAGMA user_version').get()).toEqual(version);check.close();
  });
});
