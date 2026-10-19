import { describe,it,expect } from 'vitest';
import { openDatabase, saveNewsObservation, readNewsUsefulness } from '@coqui/storage';
import { NewsIntelligenceService } from '@coqui/services';
import { newsFixture } from './fixtures/news/observations.js';
import { createNewsHandlers } from '../apps/desktop/src/main/news-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
const HOUR=3600000;
describe('news usefulness evidence',()=>{
 it('keeps successful inserted ingestion distinct from unproved eligible analysis',async()=>{
  const db=openDatabase(':memory:');try{
   db.prepare('INSERT INTO news_ingestion_diagnostics_v1 VALUES (?,?,?,?,?,?,?,?,?)').run('fixture','gdelt',1000,1,null,10,10,10,1);
   const result=await createDispatcher({handlers:createNewsHandlers('main',db,{nowMs:()=>2000})})('news.health',{});
   expect(result).toMatchObject({status:'ok',value:{lastEligibleFeatureAtMs:null,uniqueStories:null,coverageComplete:null,
    providers:expect.arrayContaining([expect.objectContaining({lastSuccessfulIngestionAtMs:1000,contributingStories:null,missingSlots:null})])}});
  }finally{db.close();}
 });
 it('counts relevant syndicated groups once and excludes future/reconstructed evidence',()=>{
  const db=openDatabase(':memory:');try{
   const config={schemaVersion:1 as const,reviewedAtMs:100,instruments:[{asset:'BTC' as const,instrument:{venue:'coinbase',productType:'spot' as const,productId:'BTC-USD'}}],publisherAliases:[]};
   db.prepare('INSERT INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)').run('coinbase','BTC-USD','spot','BTC','Bitcoin','BTC','USD',100,100);
   for(const [index,provider] of (['gdelt','marketaux'] as const).entries())saveNewsObservation(newsFixture({provider,providerArticleId:String(index),url:`https://publisher.example/${index}`,title:'Bitcoin gains after protocol approval',observedAtMs:HOUR-1000}),HOUR-900,db);
   saveNewsObservation(newsFixture({provider:'gdelt',providerArticleId:'unrelated',url:'https://publisher.example/unrelated',title:'A generic unrelated announcement',observedAtMs:HOUR-1000}),HOUR-900,db);
   expect(readNewsUsefulness(HOUR+100,db).uniqueStories).toBeNull();
   const service=new NewsIntelligenceService({database:db,clock:{nowMs:()=>HOUR+100}});service.advance(config);service.advance(config);
   const evidence=readNewsUsefulness(HOUR+100,db);
   expect(evidence.uniqueStories).toBe(1);expect(evidence.lastEligibleFeatureAtMs).toBe(HOUR+100);expect(evidence.observationAnalysisLagMs).toBe(0);
   expect(evidence.contribution.find(c=>c.provider==='gdelt')).toMatchObject({contributingStories:1,exclusiveStories:0});
   expect(evidence.contribution.find(c=>c.provider==='marketaux')).toMatchObject({contributingStories:1,exclusiveStories:0});
   expect(readNewsUsefulness(HOUR,db).uniqueStories).toBeNull();expect(evidence.missingReasons).toContain('first_page_coverage_unknown');
   db.exec("DROP TRIGGER news_feature_snapshots_v1_no_update;UPDATE news_feature_snapshots_v1 SET content_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
   expect(()=>readNewsUsefulness(HOUR+100,db)).toThrow();
  }finally{db.close();}
 });
});
